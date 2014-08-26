/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var mod_assert = require('assert-plus');
var mod_util = require('util');
var mod_fs = require('fs');
var mod_stream = require('stream');
var mod_jsprim = require('jsprim');
var mod_bunyan = require('bunyan');
var mod_dc = require('./dc.js');
var mod_insns = require('./insns.js');

var s_vmapi = require('joyent-schemas').vmapi;

var lstream = require('lstream');
var JSONStream = require('../../lib/jsonstream.js');
var VError = require('verror');
var CT_model = require('../../lib/CT_model.js');
var CT_simulation = require('../../lib/CT_simulation.js');

function
dc_insn_stream(arg)
{
	var self = this;
	var stropts;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.dc, 'arg.dc');
	mod_assert.optionalObject(arg.stropts, 'arg.stropts');
	stropts = arg.stropts || {};

	stropts.objectMode = true;
	stropts.highWaterMark = 0;
	mod_stream.Transform.call(this, stropts);

	self.dcis_dc = arg.dc;
	self.pc = 0;

	this._transform = function (insn, __ignored, done) {
		var altinsn = null;

		while (altinsn !== insn) {
			altinsn = self.dcis_dc._check_insn({ insn: insn });

			/*
			 * This instruction should not be executed, and all
			 * policy-based actions prior to this instruction's
			 * wall timestamp have been returned.  Skip it and move
			 * to the next one.
			 */
			if (altinsn === null)
				break;

			self.push({ insn: altinsn, addr: self.pc++ });
		}

		done();
	};
}
mod_util.inherits(dc_insn_stream, mod_stream.Transform);
dc_insn_stream.prototype.name = 'dc_insn_stream';

/*
 * While execution is occurring, the DC model itself logs what it's doing via
 * Bunyan.  This gives us DTrace probes for free, but it also provides a
 * convenient place to aggregate information about the model's execution and
 * forward it along to the simulation.  It's possible that we should just
 * make this a first-class citizen in CT_simulation for use by models.
 */
function
dc_logger_stream(arg)
{
	var self = this;
	var deferred = [];
	var stropts;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.glue, 'arg.glue');
	mod_assert.optionalObject(arg.stropts, 'arg.stropts');
	stropts = arg.stropts || {};

	stropts.objectMode = true;
	stropts.highWaterMark = 0;
	mod_stream.Writable.call(this, stropts);

	self.dcls_glue = arg.glue;

	self._write = function (obj, __ignored, done) {
		var sink;
		var ictx;
		var data;

		sink = self.dcls_glue.active_output_func();
		if (sink !== null) {
			ictx = self.dcls_glue.active_ictx();
			obj.ictx = ictx;
			if (deferred.length > 0) {
				data = deferred.concat(obj);
				var all = { data: data };

				setImmediate(function () {
					sink(all);
					done();
				});

				deferred.length = 0;
			} else {
				setImmediate(function () {
					sink({ data: [ obj ] });
					done();
				});
			}
		} else {
			deferred.push(obj);
		}
	};
}
mod_util.inherits(dc_logger_stream, mod_stream.Writable);
dc_logger_stream.prototype.name = 'dc_logger_stream';

function
dc_glue(arg)
{
	CT_model.call(this);

	this._simulation = arg.simulation;
	this._active_ictx = null;
	this._active_output_func = null;
	this._dc = null;
}
mod_util.inherits(dc_glue, CT_model);
dc_glue.prototype.name = 'dc_glue';

dc_glue.prototype.init = function (arg)
{
	var self = this;
	var infile;
	var open_done = false;
	var xform_err;

	mod_assert.object(arg, 'arg');
	mod_assert.optionalObject(arg.args, 'arg.args');

	if (!Array.isArray(arg.args)) {
		setImmediate(arg.cb, { input: null });
		return;
	}

	/* XXX Improved argument parsing here */

	if (arg.args.length > 1) {
		CT_simulation.scmd_fail_async(arg,
		    'Usage: %s [infile]', self.name);
		return;
	}

	self._logger = mod_bunyan.createLogger({
		name: 'DC',
		streams: [
			{
				level: 'trace',
				type: 'raw',
				stream: new dc_logger_stream({ glue: self })
			}
		]
	});

	/* XXX static inputs */

	self._dc = mod_dc.create({ logger: self._logger });
	self._active_ictx = null;
	self._active_output_func = null;

	xform_err = function (err) {
		if (open_done)
			self._simulation.set_input_error({ err: err });
		else
			arg.cb({ err: err });
	};

	infile = mod_fs.createReadStream(arg.args[0]);
	infile.on('error', xform_err);
	infile.on('open', function () {
		var result;
		var ls = new lstream();
		var js = new JSONStream();
		var is = new dc_insn_stream({ dc: self });

		ls.on('error', xform_err);
		js.on('error', xform_err);
		is.on('error', xform_err);

		result = {
			input: infile.pipe(ls).pipe(js).pipe(is)
		};
		open_done = true;
		arg.cb(result);
	});
};

dc_glue.prototype.exec = function (arg)
{
	var self = this;
	var insn;
	var e;
	var result = {};

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.ictx, 'arg.ictx');
	mod_assert.func(arg.cb, 'arg.cb');

	mod_assert.equal(self._active_ictx, null);
	mod_assert.equal(self._active_output_func, null);

	self._active_ictx = arg.ictx;
	self._active_output_func = arg.cb;

	insn = arg.ictx.insn;

	e = mod_jsprim.validateJsonObject(s_vmapi.CreateVm, insn);

	if (e !== null) {
		result.err = new VError(e, 'input is not a valid instruction');
		self._active_ictx = null;
		self._active_output_func = null;
		setImmediate(arg.cb, result);
		return;
	}

	/* XXX do it! */

	result.data.toString = function () {
		return (JSON.stringify(result.data) + '\n');
	};
	result.done = true;

	setImmediate(arg.cb, result);
};

/*
 * Check this instruction to determine whether it is the next one to execute.
 * If it is, return it.  If some other policy requires the injection of an
 * instruction here, we will return that instruction instead.  If not, we will
 * return the instruction we were passed, or null if it should be skipped
 * altogether.
 */
dc_glue.prototype._check_insn = function (arg)
{
	return (arg.insn);
};

module.exports = dc_glue;
