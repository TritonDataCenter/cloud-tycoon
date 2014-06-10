/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var mod_assert = require('assert-plus');
var mod_stream = require('stream');
var mod_util = require('util');
var mod_jsprim = require('jsprim');
var mod_events = require('events');
var mod_extsprintf = require('extsprintf');
var mod_path = require('path');

var VError = require('verror');
var fmt = mod_extsprintf.sprintf;
var CT_schema = require('./CT_schema.js');

/*
 * Events
 *
 * As a Transform Stream, the CT_engine emits the standard stream events, with
 * the standard argument types as defined by Node.  It does not emit any other
 * event classes.  As an implementation detail of the CT_simulation, these
 * events are not exposed to consumers.
 *
 * In addition, the CT_simulation object also emits events, all of which come
 * with a single argument, an Object that may or may not have certain named
 * properties as described below.  This is the same convention used with all of
 * our functions other than those defined by some interface specification
 * outside our control.
 *
 * insn-error
 *
 * Emitted when the model has indicated an error during instruction execution.
 * This event is emitted immediately before the simulation is terminated, as
 * the condition is fatal.  Argument properties:
 *
 * err (always): The err property provided by the model.
 * ictx (always): The instruction, with context, that the caused the error.
 *
 * insn-done
 *
 * Emitted each time an instruction is retired after execution by the model.
 * Argument properties:
 *
 * ictx (always): The retired instruction, with its context.
 *
 * insn-trap
 *
 * Emitted each time an instruction causes a trap.  An instruction that causes
 * a trap, whether for model-internal reasons or because a breakpoint was set
 * that matched the instruction, has not been executed at the time this
 * event is emitted.  When a trap occurs, the simulation is suspended; if the
 * simulation was running when the trap occurred, the simulation will also
 * emit a suspend event.  Argument properties:
 *
 * ictx (always): The instruction that generated the trap, with its context.
 * reason (always): An integer specifying the reason for the trap.
 *
 * Note that all instructions eventually generate an insn-done event, unless
 * the instruction causes a fatal model error.  Instructions that result in
 * a fatal error instead generate an insn-error event.  Every instruction that
 * starts execution results in emission of one of these two events.
 *
 * model-data
 *
 * Emitted when the model has generated output.  The properties of the argument
 * are model-specified and are neither set nor interpreted by the simulation.
 *
 * model-error
 *
 * Emitted when an error has occurred in the model or in any part of the system
 * responsible for fetching and dispatching instructions.  This event occurs
 * when the model indicates an input error, or when the CT_engine associated
 * with the simulation emits an 'error' event.  This event is fatal to the
 * simulation.  Properties:
 *
 * err (always): The error object associated with the underlying error.
 *
 * suspend
 *
 * Emitted when the simulation stops executing for any reason.  Properties:
 *
 * reason (sometimes): A reason code taken from the CTS_SUSPEND_XXX set of
 * constants bound to CT_simulation.
 *
 * Additional properties may be set that provide additional detail specific to
 * the reason code.
 *
 * resume
 *
 * Emitted when the simulation resumes continuous execution.  Properties: none.
 *
 * ctl-response
 *
 * This event contains an interim or final response to a pending control
 * command.  Properties:
 *
 * tag (sometimes): The tag associated with the command to which this is a
 * response, if one was provided when the command was issued.
 * err (sometimes): The error that occurred, if any, during the processing of
 * the command.  Errors represented in this manner are not fatal to the
 * simulation or the model but do represent permanent failure of the command.
 * messages (sometimes): An array containing human-readable messages about the
 * state of the command's execution, or for some commands the output of the
 * command itself.
 * data (sometimes): An object containing the next part of the data returned
 * by the command, if any.  The format of the object is command-specific.
 * done (sometimes): A boolean indicating that the command has completed and
 * no further ctl-response events will be associated with it.
 *
 * Note that every command will result in the emission of one or more
 * ctl-response events, the last of which will have either the 'err' property
 * set to some value or the 'done' property set to true.
 *
 * ctl-error
 *
 * Emitted when a fatal error occurs in processing the stream of control
 * commands, due to an unexpected internal error.  This condition is fatal to
 * the simulation, and the CT_simulation instance cannot be used after it has
 * emitted this event.  Properties:
 *
 * err (always): The error object representing the underlying error.
 */

const SUSPEND_REASONS = {
	CTS_SUSPEND_BREAKPOINT:	0,
	CTS_SUSPEND_MODEL_TRAP:	1,
	CTS_SUSPEND_CTL:	2,
	CTS_SUSPEND_TERMINATE:	3
};

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
	this._transform = function (ictx, __ignored, done) {
		var cb = function (res) {
			var pinsn = sim._sim_executing;

			mod_assert.object(res, 'res');
			mod_assert.object(pinsn);
			mod_assert.strictEqual(sim._sim_pending, null);

			sim._sim_executing = null;

			if (typeof (res.data) !== 'undefined')
				self.push(res.data);

			if (typeof (res.err) !== 'undefined') {
				res.ictx = pinsn.ictx;
				sim.emit('insn-error', res);
				sim._terminate();
				done();
				return;
			}

			if (res.trap) {
				mod_assert.notEqual(res.done, true);
				pinsn.ictx.trap = true;
				sim._sim_pending = pinsn;
				sim._suspend({ reason:
				    pinsn.ictx._bp ?
				    SUSPEND_REASONS.CTS_SUSPEND_BREAKPOINT :
				    SUSPEND_REASONS.CTS_SUSPEND_MODEL_TRAP });
				sim.emit('insn-trap',
				    { ictx: pinsn.ictx });
				return;
			}

			if (res.done) {
				sim.emit('insn-done',
				    { ictx: pinsn.ictx });

				if (sim._done)
					sim._terminate();
				done();
			}
		};

		sim._set_next({ ictx: ictx, cb: cb });
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
		model_mod = require(mod_path.resolve(arg.cmd.args[0]));

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
scmd_bp_vtor(arg)
{
	var noargs;
	var noaddr;

	noargs = (arg.cmd.args === null || arg.cmd.args === undefined ||
	    arg.cmd.args.length < 1);
	noaddr = (arg.cmd.addr === null || arg.cmd.args === undefined);

	if (noargs && noaddr) {
		return (new VError('scmd "%s" requires either an ' +
		    'address or a single argument', arg.cmd.scmd));
	}

	return (0);
}

function
scmd_bp_hdlr(arg)
{
	var self = this;
	var addr;

	if (self._model === null) {
		scmd_fail_async(arg, 'no simulation model is attached');
		return;
	}

	if (arg.cmd.addr !== null && arg.cmd.addr !== undefined)
		addr = arg.cmd.addr;
	else
		addr = arg.cmd.args[0];

	addr = parseInt(addr, 0);

	self._bplist.push(addr);
	self._bptbl[addr] = self._bplist.length - 1;

	/*
	 * Special case: if we're stopped at the instruction we're trying to
	 * breakpoint, we need to set the breakpoint directly on the pending
	 * instruction context as well; the breakpoint table is checked only
	 * at the time the instruction is fetched.  If we checked this at
	 * execution time, we'd keep firing a breakpoint that has already
	 * fired.
	 */
	if (!self.running() && self._sim_pending !== null &&
	    self._sim_pending.ictx.addr === addr) {
		self._sim_pending.ictx.trap = true;
		self._sim_pending.ictx._bp = true;
	}

	setImmediate(arg.cb, { done: true });
}

function
scmd_cont_hdlr(arg)
{
	var self = this;

	if (self.running()) {
		scmd_fail_async(arg, 'simulation model is already running');
		return;
	}

	if (self._engine === null) {
		scmd_fail_async(arg, 'no simulation is active');
		return;
	}

	self._resume();
	setImmediate(arg.cb, { done: true });
}

function
scmd_delete_vtor(arg)
{
	var noargs;
	var noaddr;

	noargs = (arg.cmd.args === null || arg.cmd.args === undefined ||
	    arg.cmd.args.length < 1);
	noaddr = (arg.cmd.addr === null || arg.cmd.args === undefined);

	if (noargs && noaddr) {
		return (new VError('scmd "%s" requires either an ' +
		    'address or a single argument', arg.cmd.scmd));
	}

	if (!noargs) {
		if (typeof (arg.cmd.args[0]) !== 'number' &&
		    arg.cmd.args[0] !== 'all') {
			return (new VError('%s: usage: [ addr ] ::%s ' +
			    '[ id | all ]', arg.cmd.scmd, arg.cmd.scmd));
		}
	}

	if (!noaddr) {
		if (typeof (arg.cmd.addr) !== 'number' &&
		    typeof (arg.cmd.addr) !== 'string') {
			return (new VError('malformed address "%s"',
			    arg.cmd.addr));
		}
	}

	return (0);
}

function
scmd_delete_hdlr(arg)
{
	var self = this;
	var slot;

	if (arg.cmd.addr !== null && arg.cmd.addr !== undefined) {
		slot = self._bptbl[arg.cmd.addr];
		if (slot === undefined) {
			scmd_fail_async(arg, 'no breakpoint matched addr "%s"',
			    arg.cmd.addr);
			return;
		}
		mod_assert.equal(self._bplist[slot], arg.cmd.addr);
		delete self._bplist[slot];
		delete self._bptbl[arg.cmd.addr];

		setImmediate(arg.cb, { done: true });
		return;
	}

	if (arg.cmd.args[0] === 'all') {
		self._bptbl = {};
		self._bplist = [];

		setImmediate(arg.cb, { done: true });
		return;
	}

	if (self._bplist[arg.cmd.args[0]] === undefined) {
		scmd_fail_async(arg, 'no event exists with id "%d"',
		    arg.cmd.args[0]);
		return;
	}
	mod_assert.equal(self._bptbl[self._bplist[arg.cmd.args[0]]],
	    arg.cmd.args[0]);
	delete self._bptbl[self._bplist[arg.cmd.args[0]]];
	delete self._bplist[arg.cmd.args[0]];

	setImmediate(arg.cb, { done: true });
}

function
scmd_events_hdlr(arg)
{
	var self = this;
	var data = [];

	self._bplist.forEach(function (addr, idx) {
		data.push({ idx: idx, addr: addr, action: 'stop' });
	});

	setImmediate(arg.cb, { data: data, done: true });
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
			_arg.input = self._default_input || process.stdin;
		} else if (typeof (_arg.input) !== 'object') {
			scmd_fail_sync(arg,
			    'model init returned a bogus input stream');
			return;
		}

		mod_assert.strictEqual(self._input, null);

		self._engine = new CT_engine({ simulation: self });

		if (self._sim_subscribers > 0) {
			self._engine.on('data', self._emit_sim);
		}
		self._engine.on('error', function (err) {
			self.emit('model-error', { err: err });
		});

		self._input = _arg.input;
		self._input.pipe(self._engine, { end: false });
		self._input.on('end', function () {
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

	Object.keys(self._commands).sort().forEach(function (name) {
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
	var addr = null;
	var state;

	if (self._model === null) {
		result = {
			messages: [ 'no simulation model is attached' ],
			done: true
		};
		setImmediate(arg.cb, result);
		return;
	}

	if (self._sim_executing !== null)
		addr = fmt('executing %s', self._sim_executing.ictx.addr);
	else if (self._sim_pending !== null)
		addr = fmt('next instruction: %s', self._sim_pending.ictx.addr);

	if (self.running()) {
		state = 'running';
		if (addr !== null)
			state += fmt(', %s', addr);
	} else {
		if (self._engine === null)
			state = 'inactive';
		else
			state = 'stopped';
		if (addr !== null)
			state += fmt(', %s', addr);
	}

	result = {
		messages: [ fmt('attached to simulation model %s (%s)',
		    self._model.name || 'unknown model', state) ],
		done: true
	};
	setImmediate(arg.cb, result);
}

function
scmd_step_hdlr(arg)
{
	var self = this;
	var complete;

	if (self._model === null) {
		scmd_fail_async(arg, 'no simulation model is attached');
		return;
	}

	if (self._engine === null) {
		scmd_fail_async(arg, 'no simulation is active');
		return;
	}

	if (self.running()) {
		scmd_fail_async(arg, 'simulation is already running');
		return;
	}

	complete = function (addr) {
		arg.cb({ done: true });
		self.removeListener('insn-done', complete);
		self.removeListener('insn-error', complete);
		self.removeListener('insn-trap', complete);
	};

	self.once('insn-done', complete);
	self.once('insn-error', complete);
	self.once('insn-trap', complete);

	self._resume({ single: true });
}

function
scmd_stop_hdlr(arg)
{
	var self = this;

	self._suspend({ reason: SUSPEND_REASONS.CTS_SUSPEND_CTL });
	setImmediate(arg.cb, { done: true });
}

function
scmd_colon_z_hdlr(arg)
{
	var self = this;

	self._bptbl = {};
	self._bplist = [];

	setImmediate(arg.cb, { done: true });
}

function
CT_simulation(arg)
{
	var self = this;
	var std_scmds;

	mod_events.EventEmitter.call(this);

	this._stop = false;
	this._running = false;
	this._done = false;
	this._model = arg.model || null;
	this._engine = null;
	this._input = null;
	this._default_input = null;
	this._ctl_subscribers = 0;
	this._sim_subscribers = 0;
	this._sim_pending = null;
	this._sim_executing = null;
	this._ctl_pending = null;
	this._bptbl = {};
	this._bplist = [];
	this._commands = {};

	arg.simulation = this;
	this._ctlstream = new CT_ctlstream(arg);

	this._emit_ctl = function (_arg) {
		self.emit('ctl-response', _arg);
	};

	this._emit_sim = function (_arg) {
		self.emit('model-data', _arg);
	};

	self.on('newListener', function (evt) {
		switch (evt) {
		case 'ctl-response':
			if (self._ctl_subscribers++ === 0) {
				self._ctlstream.on('data', self._emit_ctl);
				self._ctlstream.resume();
			}
			break;
		case 'model-data':
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
		case 'model-data':
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

	self._ctlstream.on('error', function (err) {
		self.emit('ctl-error', { err: err });
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
			str: 'bp',
			aliases: [ ':b' ],
			handler: scmd_bp_hdlr,
			vtor: scmd_bp_vtor,
			synopsis: 'set a breakpoint'
		},
		{
			str: 'cont',
			aliases: [ ':c' ],
			handler: scmd_cont_hdlr,
			vtor: scmd_noargs_vtor,
			synopsis: 'continue simulation'
		},
		{
			str: 'delete',
			handler: scmd_delete_hdlr,
			vtor: scmd_delete_vtor,
			synopsis: 'delete traced simulation events'
		},
		{
			str: 'events',
			handler: scmd_events_hdlr,
			vtor: scmd_noargs_vtor,
			synopsis: 'list traced simulation events'
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
			synopsis: 'single-step simulation to next action'
		},
		{
			str: 'stop',
			handler: scmd_stop_hdlr,
			hidden: true,
			vtor: scmd_noargs_vtor
		},
		{
			str: ':z',
			handler: scmd_colon_z_hdlr,
			vtor: scmd_noargs_vtor,
			synopsis: 'delete all traced simulation events'
		}
	];

	std_scmds.forEach(function (scmd) {
		/*
		 * No errors are possible here because no one else could have
		 * registered any scmds before us.
		 */
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

CT_simulation.prototype._suspend = function (arg)
{
	var self = this;

	if (!self._running)
		return;

	if (self._sim_executing !== null) {
		self._stop = true;
	} else {
		self._stop = false;
		self._running = false;
		self.emit('suspend', arg || {});
	}
};

CT_simulation.prototype._resume = function (arg)
{
	var self = this;
	var single = false;

	if (self._running)
		return;

	if (self._stop) {
		self._stop = false;
	} else {
		if (typeof (arg) === 'object' && arg.single)
			single = true;

		self._running = true;
		self.emit('resume', arg || {});
		if (single) {
			self._stop = true;
			mod_assert.strictEqual(self._exec_next(), 0);
		} else {
			self._exec_next();
		}
	}
};

CT_simulation.prototype._is_breakpoint = function (arg)
{
	var self = this;
	var addr;

	mod_assert.object(arg, 'arg');

	addr = arg.addr;

	return (self._bptbl[addr] !== undefined);
};

/*
 * We've fetched an instruction.  At this point we need to determine whether
 * the instruction should trap or be sent to the model for execution.  Note
 * that the model may not be running, in which case we simply save the
 * instruction for the next opportunity to execute it.
 */
CT_simulation.prototype._set_next = function (insn)
{
	var self = this;
	var ictx = insn.ictx;

	mod_assert.strictEqual(self._sim_pending, null);

	if (self._is_breakpoint({ addr: ictx.addr })) {
		ictx.trap = true;
		ictx._bp = true;
	}

	self._sim_pending = insn;

	/*
	 * Process deferred suspend here.  We do this instead of in the
	 * _transform() function of the engine so that we always know the
	 * next instruction to be executed; if we suspended there instead,
	 * there would be no pending instruction when we emit the suspend
	 * event.
	 */
	if (self._stop) {
		self._suspend({ reason:
		    SUSPEND_REASONS.CTS_SUSPEND_CTL });
	}

	if (self.running())
		mod_assert.strictEqual(self._exec_next(), 0);
};

CT_simulation.prototype._exec_next = function ()
{
	var self = this;
	var ninsn;

	if (self._sim_pending === null)
		return (-1);

	ninsn = self._sim_pending;

	if (ninsn.ictx.trap) {
		ninsn.ictx.trap = false;
		self._suspend({ reason: ninsn.ictx._bp ?
		    SUSPEND_REASONS.CTS_SUSPEND_BREAKPOINT :
		    SUSPEND_REASONS.CTS_SUSPEND_MODEL_TRAP });
		return (0);
	}

	self._sim_pending = null;
	self._sim_executing = ninsn;

	self._model.exec(ninsn);
	return (0);
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

	if (typeof (arg.model) !== 'object') {
		scmd_fail_async(arg, 'model instantiation returned non-object');
		return;
	}

	if (self._model !== null) {
		self._terminate();
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

CT_simulation.prototype._terminate = function ()
{
	var self = this;

	if (self._model === null)
		return;

	self._sim_pending = null;
	self._sim_executing = null;
	self._stop = false;
	self._suspend({ reason: SUSPEND_REASONS.CTS_SUSPEND_TERMINATE });

	if (self._input !== null) {
		mod_assert.notEqual(self._engine, null);
		self._input.unpipe(self._engine);
		self._input = null;
		self._engine = null;
	}
};

CT_simulation.prototype.set_input_error = function (arg)
{
	var self = this;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg, 'arg.err');

	self.emit('model-error', arg);
	self._terminate();
};

CT_simulation.prototype.addr = function ()
{
	var self = this;
	var insn;

	if (self._sim_executing !== null)
		insn = self._sim_executing;
	else if (self._sim_pending !== null)
		insn = self._sim_pending;
	else
		return (null);

	return (insn.ictx.addr);
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

Object.keys(SUSPEND_REASONS).forEach(function (r) {
	CT_simulation[r] = SUSPEND_REASONS[r];
});

module.exports = CT_simulation;
