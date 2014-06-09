/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var mod_assert = require('assert-plus');
var mod_extsprintf = require('extsprintf');

var CT_simulation = require('./CT_simulation.js');
var fmt = mod_extsprintf.sprintf;

/*
 * Simulation Models
 *
 * In the CT system, all of the application-specific work is done by 'models'.
 * The model contains all the business logic relevant to the simulation,
 * including:
 *
 * - Interpretation of arguments
 * - Interpretation of input
 * - Maintenance of modeled system state
 * - Generation of any output, both intermediate and global
 *
 * The purpose of the rest of the CT system is to drive a model through a
 * series of input objects representing the scenario being simulated, and to
 * observe (and possibly manipulate) the state of the model during execution.
 *
 * Model Modes
 *
 * A model can be run in either of two modes:
 *
 * - In Standalone Mode, the model is executed directly on the command line;
 *   e.g., '/path/to/node ./some_model.js ...'.  In Standalone Mode, the model
 *   reads its input objects and generates output to process.stderr until all
 *   input objects have been consumed or an error occurs.  There is no
 *   control flow outside the model itself; the model is initialised, runs,
 *   and terminates in a linear fashion.  Standalone mode is analogous to
 *   executing a normal Unix program in a shell.
 *
 * - In Introspection Mode, the model executes in a manner prescribed by an
 *   externally-managed control mechanism.  This control mechanism may
 *   stop the simulation, observe or modify the model's internal state, and
 *   result execution out of band with respect to the flow of input and output
 *   objects through the model.  Introspection mode is analogous to running
 *   a program in a debugger, although the control logic shares a process
 *   with the model.
 *
 * Execution Contexts
 *
 * Models implement interfaces that the simulation driver will execute in one
 * of two contexts.
 *
 * - In Simulation Context, the model executes code to process input objects
 *   and advance the state of the model through the simulation scenario.
 *   The input objects are read by the driver from the ReadableStream provided
 *   by the model during initialisation and passed to the model's exec()
 *   method in Simulation Context.  Every input object (aka 'instruction')
 *   will be passed to the model for execution exactly once; execution of an
 *   instruction is not interruptible.  Therefore models should be constructed
 *   with fine-grained instructions that will execute quickly.  Instructions
 *   are always passed in order and there is no mechanism for repeating any
 *   sequence of already-executed instructions; however, there is no
 *   restriction on how the model's input generator may function.  For example,
 *   the model could save the 'address' of the next instruction to be executed
 *   and the instruction stream could produce an instruction object by looking
 *   up that instruction's attributes in a table.  The mechanism provided is
 *   therefore not Turing-complete by itself, but a model can easily implement
 *   a Turing-complete language using the provided primitives.  Accordingly,
 *   it is also possible for a model to provide a means for control-flow
 *   consumers to modify the model's state in arbitrary ways, including
 *   instructions to be executed in the future.
 *
 * - Most other code is run in Control Context.  Just as only one input object
 *   is ever being processed by the model at one time, so too can only one
 *   control command be outstanding at one time.  The simulation driver allows
 *   the model (and other components of the system) to register handlers for
 *   arbitrary control commands.  If a matching control command is received
 *   by the driver, it will execute the handler in Control Context.  At
 *   present, control commands are executed only when the simulation has been
 *   suspended (that is, when there is no instruction being executed by the
 *   model); however, models must not rely on this and must be capable of
 *   execution control commands in Control Context even when the model is also
 *   waiting for completion of some other activity in Simulation Context.
 *
 * Astute observers will recognise a rough analogy with an ordinary
 * stored-program computer: the model contains a CPU's fetch unit (the input
 * stream), its decode/execute unit (the execution logic), and a means of
 * handling asynchronous interrupts (control commands).  It also has a means
 * of generating precise traps, closing the loop with the control flow.
 */

function
CT_model()
{
}

/*
 * This method is always invoked in control context.  It must respond with a
 * result object with an 'input' property set to the ReadableStream from
 * which this simulation will be fed instructions via exec().  Other setup and
 * processing of arguments is optional and model-specific.
 */
CT_model.prototype.init = function (arg)
{
	var result;

	mod_assert.object(arg, 'arg');
	mod_assert.optionalObject(arg.args, 'arg.args');
	mod_assert.func(arg.cb, 'arg.cb');

	result = {
		input: process.stdin
	};
	setImmediate(arg.cb, result);
};

CT_model.prototype.name = 'CT_model';

/*
 * This method is always invoked in simulation context.  This is where the
 * actual simulation occurs; each input element is provided, in order, via
 * the 'ictx' property of the argument.  The argument also has a 'cb' property,
 * referencing a function that may be invoked any number of times; however:
 *
 * - The last invocation must have *either* a 'done' property set to true, or
 *   an 'err' property set to an exception object (if the instruction could
 *   not be interpreted or executed).
 * - Any invocation may have a 'data' property; these model-specific values
 *   will constitute the output of the simulation and will be made available
 *   to consumers, in order.  If the argument to the callback has an 'err'
 *   property, the 'data' property (if any) is ignored.
 *
 * All invocations of this callback must be asynchronous; if your method
 * completes synchronously, use setImmediate to invoke the callback.  You may
 * also use CT_simulation.exec_fail_async in immediate context to indicate
 * failure (use CT_simulation.exec_fail_sync in async callback context).
 */
CT_model.prototype.exec = function (arg)
{
	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.ictx, 'arg.ictx');
	mod_assert.func(arg.cb, 'arg.cb');

	setImmediate(arg.cb, { data: arg.ictx, done: true });
};

/*
 * A model can be consumed by a driver that will construct the simulation
 * and read and interpret the model's output itself.  It can also be a
 * standalone program that simply takes input and runs to completion, spewing
 * its output to stdout.  This code abstracts the steps necessary to the second
 * model away so that models need not implement them.  Instead, the
 * implementation simply does:
 *
 * CT_model.init_module({ module: module, create: <function> });
 *
 * where the 'create' property is set to a function that returns a new
 * instance of the implementation model.  This method of your module (not your
 * model object) is always invoked in control context.  It is passed an object
 * with two properties:
 *
 * - simulation is the CT_simulation object representing the simulation in
 *   which the model instance will run.
 * - args is an Array of string arguments to the attach scmd; it may be
 *   absent, null, or an empty Array if no arguments were provided.
 *
 * This method must execute synchronously and return an object derived from
 * CT_model with at least the init() and exec() methods defined.
 *
 * If you need to register model-specific scmds, this function should normally
 * do so.  You will not otherwise have access to the simulation object required
 * to do that unless you store a reference to it.
 *
 * If your model generates output objects that have a 'toString' method,
 * that method will be invoked with the object as its only argument and the
 * return value written to process.stdout.  Likewise, if your model generates
 * errors with a 'toString' method, that method will be invoked and its
 * return value written to process.stderr.  Otherwise, the output object will
 * be written directly to process.stdout, and errors will be processed by
 * writing the 'message' property to process.stderr.  This behaviour applies
 * only in standalone mode; other consumers may or may not invoke these
 * methods if present (but likely should, if writing them to a bytestream).
 *
 * Errors are not considered to be fatal in standalone mode.
 */
CT_model.init_module = function (arg)
{
	var model;
	var sim;
	var cmd;

	/*
	 * Driver mode: set up the module and return; the driver does everything
	 * else later.
	 */
	if (require.main !== arg.module) {
		arg.module.exports = { create: arg.create };
		return;
	}

	/*
	 * Standalone mode: instantiate ourselves, then use attach ourselves to
	 * a simulation.  We cannot use the attach scmd here because we have
	 * a model module object, not its string filename, and objects that
	 * cannot be expressed as JSON cannot be passed through the control
	 * pipeline.  Once attach is complete, we attach some simple event
	 * handlers to the simulation and fire it up.
	 */
	sim = new CT_simulation({});
	model = arg.create({ simulation: sim });
	sim.attach_standalone({ model: model, cb: function (_arg) {
		if (typeof (_arg.err) !== 'undefined')
			throw (_arg.err);

		sim.on('ctl-response', function () {});
		sim.on('ctl-error', function (err) {
			process.stderr.write(
			    'Unexpected control plane error\n');
			process.stderr.write(fmt('%s\n', err.toString()));
			process.exit(2);
		});

		sim.on('sim-data', function (obj) {
			var out;

			if (typeof (obj.toString) === 'function')
				out = obj.toString();
			else
				out = obj;

			process.stdout.write(fmt('%s\n', out));
		});
		sim.on('sim-error', function (err) {
			var out;

			if (typeof (err.toString) === 'function')
				out = err.toString();
			else
				out = err.message || 'unknown error';

			process.stderr.write(fmt('%s\n', out));
		});

		cmd = {
			scmd: 'run'
		};
		if (process.argv.length > 2)
			cmd.args = [ process.argv[2] ];

		sim.inject_ctl({ cmd: cmd });
	} });
};

function
create(arg)
{
	return (new CT_model(arg));
}

CT_model.init_module({ module: module, create: create });
module.exports = CT_model;
