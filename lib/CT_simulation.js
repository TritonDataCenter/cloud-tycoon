/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var mod_assert = require('assert-plus');
var mod_stream = require('stream');
var mod_util = require('util');
var mod_jsprim = require('jsprim');
var mod_events = require('events');
var mod_extsprintf = require('extsprintf');

var VError = require('verror');
var fmt = mod_extsprintf.sprintf;
var CT_schema = require('./CT_schema.js');

function
CT_engine(arg)
{
	var self = this;
	var sim;
	var stropts;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.simulation, 'arg.simulation');
	mod_assert.optionalObject(arg.stropts, 'arg.stropts');
	stropts = arg.stropts || {};

	stropts.objectMode = true;
	stropts.highWaterMark = 0;
	mod_stream.Transform.call(this, stropts);

	sim = arg.simulation;

	/*
	 * This is not in the prototype because we would then have to attach
	 * either the simulation or this completion callback (with a closure
	 * around that simulation) to the object.  We can't do that because
	 * we don't own the TransformStream property namespace; node does.
	 */
	this._transform = function (insn, __ignored, done) {
		var model;
		var cb = function (res) {
			mod_assert.object(res, 'res');

			if (typeof (res.data) !== 'undefined')
				self.push(res.data);

			if (typeof (res.err) !== 'undefined') {
				sim._sim_pending = null;
				if (sim._stop)
					sim._suspend();
				done(res.err);
				return;
			}

			if (res.done) {
				sim._sim_pending = null;
				if (sim._stop)
					sim._suspend();
				done();
				return;
			}
		};

		mod_assert.ok(sim._sim_pending === null);
		sim._sim_pending = {
			insn: insn,
			cb: cb
		};

		if (!sim.running())
			return;

		model = sim._get_model();
		mod_assert.object(model);
		model.exec(sim._sim_pending);
	};
}
mod_util.inherits(CT_engine, mod_stream.Transform);
CT_engine.prototype.name = 'CT_engine';

function
CT_ctlstream(arg)
{
	var self = this;
	var stropts = {};
	var sim;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.simulation, 'arg.simulation');
	mod_assert.optionalObject(arg.stropts, 'arg.stropts');
	stropts = arg.stropts || {};

	stropts.objectMode = true;
	stropts.highWaterMark = 0;
	mod_stream.Transform.call(this, stropts);

	sim = arg.simulation;

	this._transform = function (cmd, __ignored, done) {
		var cb = function (res) {
			mod_assert.object(res, 'res');

			if (typeof (cmd.tag) === 'string')
				res.tag = cmd.tag;
			self.push(res);

			if (res.done || typeof (res.err) !== 'undefined') {
				sim._ctl_pending = null;
				done();
			}
		};

		mod_assert.ok(sim._ctl_pending === null);
		sim._ctl_pending = {
			cmd: cmd,
			cb: cb
		};

		sim._dispatch(sim._ctl_pending);
	};
}
mod_util.inherits(CT_ctlstream, mod_stream.Transform);
CT_ctlstream.prototype.name = 'CT_ctlstream';

function
scmd_noargs_vtor(arg)
{
	var args;
	var addr;

	args = arg.cmd.args;
	addr = arg.cmd.addr;

	if (args !== null && args !== undefined && args.length !== 0) {
		return (new VError('scmd "%s" accepts no arguments',
		    arg.cmd.scmd));
	}

	if (addr !== null && addr !== undefined) {
		return (new VError('scmd "%s" accepts no address',
		    arg.cmd.scmd));
	}

	return (0);
}

function
verror_varargs_ctor(errargs)
{
	/*
	 * Varargs ctor called from a varargs function; this is spicy!  We need
	 * to create a new VError, but we need to have the constructor called
	 * with a variable argument list.  To do this, we are going to use
	 * Function.bind() to create a new constructor that always runs with
	 * the argument list we provide, then invoke it using the new operator.
	 * In order to do this, we will apply() the argument list errargs to
	 * bind() in the context of VError (the original constructor); because
	 * the first argument to bind() is the context in which the return
	 * function shall execute, we also need to make sure the first argument
	 * in the array is VError itself.
	 */
	errargs.unshift(VError);
	return (new (Function.prototype.bind.apply(VError, errargs)));
}

function
scmd_fail_async(/* arg, ... */)
{
	var arg = arguments[0];
	var errargs = Array.prototype.slice.call(arguments, 1);
	var err = verror_varargs_ctor(errargs);

	mod_assert.object(arg, 'arg');
	mod_assert.func(arg.cb, 'arg.cb');

	setImmediate(arg.cb, { err: err });
}

function
scmd_fail_sync(/* arg, ... */)
{
	var arg = arguments[0];
	var errargs = Array.prototype.slice.call(arguments, 1);
	var err = verror_varargs_ctor(errargs);

	mod_assert.object(arg, 'arg');
	mod_assert.func(arg.cb, 'arg.cb');

	arg.cb({ err: err });
}

function
scmd_algol_hdlr(arg)
{
	setImmediate(arg.cb, {
		messages: [ 'no adb here' ],
		done: true
	});
}

function
scmd_attach_vtor(arg)
{
	var args;

	args = arg.cmd.args;
	if (args === null || args === undefined || args.length < 1) {
		return (new VError('scmd "%s" requires at least 1 argument',
		    arg.cmd.scmd));
	}

	return (0);
}

/*
 * Invokes the model module's create method and attaches it to the controller
 * as _model.  This does not actually execute anything.  Unlike mdb, we don't
 * have any concept of detaching from a simulation that then continues to
 * run; a simulation that's not running standalone cannot be detached, ever.
 * So if something is already running, we fail.  If something else is attached
 * but not running, we throw it away.
 */
function
scmd_attach_hdlr(arg)
{
	var self = this;
	var model_mod;
	var model;

	try {
		model_mod = require(arg.cmd.args[0]);

		model = model_mod.create({
			simulation: self,
			args: arg.cmd.args.slice(1)
		});
	} catch (e) {
		self._model = null;
		scmd_fail_async(arg, e,
		    'unable to attach to model "%s"', arg.cmd.args[0]);
		return;
	}

	arg.model = model;
	self._attach_impl(arg);
}

function
scmd_cont_hdlr(arg)
{
	var self = this;

	if (self.running()) {
		scmd_fail_async(arg, 'simulation model is already running');
		return;
	}

	if (self._done) {
		scmd_fail_async(arg, 'the simulation has completed');
		return;
	}

	if (self._engine === null) {
		scmd_fail_async(arg, 'no simulation is active');
		return;
	}

	self._resume();
	setImmediate(arg.cb, { done: true });
}

/*
 * Invokes the model instance's init method.  When that's finished, we attach
 * the provided input stream to the engine and start ourselves up.
 */
function
scmd_run_hdlr(arg)
{
	var self = this;
	var cb;

	/*
	 * The model is responsible for actually processing these arguments
	 * and giving us back a ReadableStream that will provide the
	 * instruction objects that will later be fed to it.
	 */
	if (self._model === null) {
		scmd_fail_async(arg, 'no simulation model is attached');
		return;
	}

	if (self.running()) {
		scmd_fail_async(arg, 'simulation is already running');
		return;
	}

	cb = function (_arg) {
		mod_assert.object(_arg, '_arg');

		if (typeof (_arg.err) !== 'undefined') {
			scmd_fail_sync(arg, _arg.err, 'model init failed');
			return;
		}

		if (_arg.input === null) {
			arg._input = self._default_input || process.stdin;
		} else if (typeof (_arg.input) !== 'object') {
			scmd_fail_sync(arg,
			    'model init returned a bogus input stream');
			return;
		}

		if (self._input !== null) {
			self._stop = false;
			self._input.unpipe(self._engine);
			self._input = null;
			self._sim_pending = null;
		}

		self._engine = new CT_engine({ simulation: self });

		if (self._sim_subscribers > 0) {
			self._engine.on('data', self._emit_sim);
		}
		self._engine.on('error', function (err) {
			self.emit('ctl-error', err);
		});

		self._input = _arg.input;
		self._input.pipe(self._engine, { end: false });
		self._input.on('end', function () {
			self._suspend();
			self._done = true;
		});
		self._done = false;
		self._resume();

		arg.cb({ done: true });
	};

	self._model.init({ args: arg.cmd.args, cb: cb });
}

function
scmd_scmds_hdlr(arg)
{
	var self = this;
	var result;
	var data = [];

	Object.keys(self._commands).forEach(function (name) {
		if (self._commands[name].hidden)
			return;
		data.push(fmt('%s\t\t- %s',
		    name, self._commands[name].synopsis));
	});

	result = {
		messages: data,
		done: true
	};

	setImmediate(arg.cb, result);
}

function
scmd_status_hdlr(arg)
{
	var self = this;
	var result;

	if (self._model === null) {
		result = {
			messages: [ 'no simulation model is attached' ],
			done: true
		};
		setImmediate(arg.cb, result);
		return;
	}

	result = {
		messages: [ fmt('attached to simulation model %s (%s)',
		    self._model.name || 'unknown model',
		    self.running() ? 'running' : 'stopped') ],
		done: true
	};
	setImmediate(arg.cb, result);
}

function
scmd_step_hdlr(arg)
{
	/* XXX breakpoints */
	setImmediate(arg.cb, { done: true });
}

function
scmd_stop_hdlr(arg)
{
	var self = this;

	self._suspend();
	setImmediate(arg.cb, { done: true });
}

function
CT_simulation(arg)
{
	var self = this;
	var std_scmds;

	mod_events.EventEmitter.call(this);

	this._done = false;
	this._stop = false;
	this._running = false;
	this._model = arg.model || null;
	this._engine = null;
	this._input = null;
	this._ctl_subscribers = 0;
	this._sim_subscribers = 0;
	this._sim_pending = null;
	this._ctl_pending = null;
	this._commands = {};

	arg.simulation = this;
	this._ctlstream = new CT_ctlstream(arg);

	this._emit_ctl = function (data) {
		self.emit('ctl-response', data);
	};

	this._emit_sim = function (data) {
		self.emit('sim-data', data);
	};

	self.on('newListener', function (evt) {
		switch (evt) {
		case 'ctl-response':
			if (self._ctl_subscribers++ === 0) {
				self._ctlstream.on('data', self._emit_ctl);
				self._ctlstream.resume();
			}
			break;
		case 'sim-data':
			/*
			 * The short-circuit is important here; we need to
			 * count would-be subscribers even if there's no engine.
			 */
			if (self._sim_subscribers++ === 0 &&
			    self._engine !== null) {
				self._engine.on('data', self._emit_sim);
			}
			break;
		default:
			break;
		}
	});

	self.on('removeListener', function (evt) {
		switch (evt) {
		case 'ctl-response':
			self._ctlstream.pause();
			if (--self._ctl_subscribers === 0) {
				self._ctlstream.removeListener('data',
				    self._emit_ctl);
			}
			break;
		case 'sim-data':
			if (--self._sim_subscribers === 0 &&
			    self._engine !== null) {
				self._engine.removeListener('data',
				    self._emit_sim);
			}
			break;
		default:
			break;
		}
	});

	std_scmds = [
		{
			str: '$a',
			handler: scmd_algol_hdlr,
			hidden: true
		},
		{
			str: 'attach',
			aliases: [ ':A' ],
			handler: scmd_attach_hdlr,
			vtor: scmd_attach_vtor,
			synopsis: 'attach to a simulation model'
		},
		{
			str: 'cont',
			aliases: [ ':c' ],
			handler: scmd_cont_hdlr,
			vtor: scmd_noargs_vtor,
			synopsis: 'continue simulation'
		},
		{
			str: 'run',
			aliases: [ ':r' ],
			handler: scmd_run_hdlr,
			synopsis: 'run simulation from the beginning'
		},
		{
			str: 'scmds',
			handler: scmd_scmds_hdlr,
			vtor: scmd_noargs_vtor,
			synopsis: 'list available scmds'
		},
		{
			str: 'status',
			handler: scmd_status_hdlr,
			vtor: scmd_noargs_vtor,
			synopsis: 'simulation status'
		},
		{
			str: 'step',
			handler: scmd_step_hdlr,
			vtor: scmd_noargs_vtor,
			synopsis: 'simulate the next event'
		},
		{
			str: 'stop',
			handler: scmd_stop_hdlr,
			hidden: true,
			vtor: scmd_noargs_vtor
		}
	];

	std_scmds.forEach(function (scmd) {
		/* XXX errors */
		self.register_scmd(scmd);
	});
}
mod_util.inherits(CT_simulation, mod_events.EventEmitter);
CT_simulation.prototype.name = 'CT_simulation';

/*
 * These are available as utilities for people implementing scmds in other
 * contexts.  The analogous routines for models to use when failing to exec
 * an instruction are the same, but only by accident; scmd context is always
 * in the control path and instruction execution is not.  So we provide these
 * under a different name to avoid confusion.
 */
CT_simulation.scmd_fail_async = scmd_fail_async;
CT_simulation.scmd_fail_sync = scmd_fail_sync;
CT_simulation.scmd_noargs_vtor = scmd_noargs_vtor;

CT_simulation.exec_fail_async = scmd_fail_async;
CT_simulation.exec_fail_sync = scmd_fail_sync;

CT_simulation.prototype.running = function ()
{
	return (this._running);
};

CT_simulation.prototype._suspend = function ()
{
	if (!this._running)
		return;

	if (this._sim_pending !== null) {
		this._stop = true;
	} else {
		this._stop = false;
		this._running = false;
		this.emit('suspend');
	}
};

CT_simulation.prototype._resume = function ()
{
	if (this._running)
		return;

	if (this._stop) {
		this._stop = false;
	} else {
		this._running = true;
		this.emit('resume');
		if (this._sim_pending !== null)
			this._model.exec(this._sim_pending);
	}
};

CT_simulation.prototype._get_model = function ()
{
	return (this._model);
};

CT_simulation.prototype._attach_impl = function (arg)
{
	var self = this;

	if (self.running()) {
		scmd_fail_async(arg, 'a simulation model is running');
		return;
	}

	if (self._model !== null) {
		if (self._input !== null) {
			self._stop = false;
			self._input.unpipe(self._engine);
			self._input = null;
			self._sim_pending = null;
		}
		self._model = null;
	}

	self._model = arg.model;
	setImmediate(arg.cb, { done: true });
};

CT_simulation.prototype.attach_standalone = function (arg)
{
	var self = this;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.model, 'arg.model');
	mod_assert.func(arg.cb, 'arg.cb');

	self._attach_impl(arg);
};

CT_simulation.prototype.plumb_ctl = function (arg)
{
	var self = this;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.stream, 'arg.stream');

	arg.stream.pipe(self._ctlstream);
};

CT_simulation.prototype.unplumb_ctl = function (arg)
{
	var self = this;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.stream, 'arg.stream');

	arg.stream.unpipe(self._ctlstream);
};

CT_simulation.prototype.set_default_input = function (arg)
{
	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.stream, 'arg.stream');

	this._default_input = arg.stream;
};

CT_simulation.prototype.inject_ctl = function (arg)
{
	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.cmd, 'arg.cmd');

	this._ctlstream.write(arg.cmd);
};

CT_simulation.prototype.register_scmd = function (arg)
{
	var self = this;
	var badname;
	var names = [];

	mod_assert.object(arg, 'arg');
	mod_assert.string(arg.str, 'arg.str');
	mod_assert.func(arg.handler, 'arg.handler');
	mod_assert.optionalArrayOfString(arg.aliases, 'arg.aliases');
	mod_assert.optionalBool(arg.hidden, 'arg.hidden');
	mod_assert.optionalString(arg.synopsis, 'arg.synopsis');
	mod_assert.optionalFunc(arg.vtor, 'arg.vtor');
	mod_assert.optionalObject(arg.ctx, 'arg.ctx');

	names = arg.aliases || [];
	names.unshift(arg.str);

	if (names.some(function (name) {
		if (typeof (self._commands[name]) !== 'undefined') {
			if (typeof (badname) !== 'string')
				badname = name;
			return (true);
		}
		return (false);
	})) {
		return (new VError('scmd "%s" is already registered', badname));
	}

	names.forEach(function (name) {
		self._commands[name] = {
			f: arg.handler,
			synopsis: arg.synopsis || 'no synopsis available',
			hidden: arg.hidden || false,
			vtor: arg.vtor || null,
			ctx: arg.ctx || null
		};
	});

	return (0);
};

CT_simulation.prototype._dispatch = function (arg)
{
	var self = this;
	var cmd;
	var scmd;
	var e;

	mod_assert.object(arg, 'arg');
	mod_assert.func(arg.cb, 'arg.cb');

	cmd = arg.cmd;

	e = mod_jsprim.validateJsonObject(CT_schema.sScmd, cmd);
	if (e !== null) {
		scmd_fail_async(arg, e,
		    'internal error: malformed scmd "%j"', cmd);
		return;
	}

	if (typeof (self._commands[cmd.scmd]) !== 'object') {
		scmd_fail_async(arg, 'scmd "%s" is unknown', cmd.scmd);
		return;
	}

	scmd = self._commands[cmd.scmd];

	if (typeof (scmd.vtor) === 'function') {
		var verr;

		verr = scmd.vtor.call(scmd.ctx || self, arg);
		if (verr !== 0) {
			scmd_fail_async(arg, verr,
			    'syntax error invoking scmd "%s"', cmd.scmd);
			return;
		}
	}

	scmd.f.call(scmd.ctx || self, arg);
};

module.exports = CT_simulation;
