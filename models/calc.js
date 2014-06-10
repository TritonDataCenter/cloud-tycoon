/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var mod_assert = require('assert-plus');
var mod_util = require('util');
var mod_fs = require('fs');
var mod_stream = require('stream');

var lstream = require('lstream');
var JSONStream = require('../lib/jsonstream.js');
var VError = require('verror');
var CT_model = require('../lib/CT_model.js');
var CT_simulation = require('../lib/CT_simulation.js');

/*
 * This is a silly simulation machine.  It is useful only for testing the rest
 * of the CT infrastructure and does not model anything of value.  Instead, it
 * simply models an accumulator-based 4-function calculator.
 *
 * All instructions are of the form:
 *
 * {
 * 	op: 'add' | 'sub' | 'div' | 'mul' | 'set',
 * 	value: <integer>
 * }
 *
 * The output are Objects with the following properties:
 *
 * {
 * 	pre: <integer> (the accumulator value prior to execution),
 *	insn: <object> (the instruction executed),
 *	addr: <integer> (the address of the instruction),
 *	post: <integer> (the accumulator value after execution),
 * }
 *
 * This needs to be kept working; if it does not work, the generic nature of
 * the simulation engine is not being preserved.
 */

function
CalcInsnStream(arg)
{
	var self = this;
	var stropts;
	var pc = 0;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.calc, 'arg.calc');
	mod_assert.optionalObject(arg.stropts, 'arg.stropts');
	stropts = arg.stropts || {};

	stropts.objectMode = true;
	stropts.highWaterMark = 0;
	mod_stream.Transform.call(this, stropts);

	this._transform = function (insn, __ignored, done) {
		var out = {};

		out.insn = insn;
		out.addr = pc++;

		self.push(out);
		done();
	};
}
mod_util.inherits(CalcInsnStream, mod_stream.Transform);
CalcInsnStream.prototype.name = 'CalcInsnStream';

function
Calc(arg)
{
	CT_model.call(this);

	this._simulation = arg.simulation;
	this._accum = 0;
}
mod_util.inherits(Calc, CT_model);
Calc.prototype.name = 'Calc';

Calc.prototype.init = function (arg)
{
	var self = this;
	var result;
	var infile;
	var open_done = false;
	var xform_err;

	mod_assert.object(arg, 'arg');
	mod_assert.optionalObject(arg.args, 'arg.args');

	if (!Array.isArray(arg.args)) {
		setImmediate(arg.cb, { input: null });
		return;
	}

	if (arg.args.length > 1) {
		CT_simulation.scmd_fail_async(arg,
		    'Usage: %s [infile]', self.name);
		return;
	}

	this._accum = 0;

	xform_err = function (err) {
		if (open_done)
			self._simulation.set_input_error({ err: err });
		else
			arg.cb({ err: err });
	};

	infile = mod_fs.createReadStream(arg.args[0]);
	infile.on('error', xform_err);
	infile.on('open', function () {
		var ls = new lstream();
		var js = new JSONStream();
		var is = new CalcInsnStream({ calc: self });

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

Calc.prototype.exec = function (arg)
{
	var self = this;
	var insn;
	var result = {};

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.ictx, 'arg.ictx');
	mod_assert.func(arg.cb, 'arg.cb');

	insn = arg.ictx.insn;

	if (typeof (insn.op) !== 'string' ||
	    typeof (insn.value) !== 'number') {
		result.err = new VError('invalid action encountered: "%j"',
		    insn);
		setImmediate(arg.cb, result);
		return;
	}

	result.data = {
		pre: self._accum,
		insn: insn
	};

	switch (insn.op) {
	case 'add':
		self._accum += insn.value;
		break;
	case 'sub':
		self._accum -= insn.value;
		break;
	case 'mul':
		self._accum *= insn.value;
		break;
	case 'div':
		self._accum /= insn.value;
		break;
	case 'set':
		self._accum = insn.value;
		break;
	default:
		result.err = new VError('invalid opcode %s', insn.op);
		setImmediate(arg.cb, result);
		return;
	}

	result.data.addr = arg.ictx.addr;
	result.data.post = self._accum;
	result.data.toString = function () {
		return (JSON.stringify(result.data) + '\n');
	};
	result.done = true;

	setTimeout(function () {
		arg.cb(result);
	}, 1000);
};

function
create(arg)
{
	return (new Calc(arg));
}

CT_model.init_module({ module: module, create: create });
