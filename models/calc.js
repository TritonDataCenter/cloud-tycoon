/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var mod_assert = require('assert-plus');
var mod_util = require('util');
var mod_fs = require('fs');

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
 *	pc: <integer> (program counter address of the instruction),
 *	insn: <object> (the instruction executed),
 *	post: <integer> (the accumulator value after execution),
 *	nextpc: <integer> (the address of the next instruction)
 * }
 *
 * This needs to be kept working; if it does not work, the generic nature of
 * the simulation engine is not being preserved.
 */

function
Calc(arg)
{
	CT_model.call(this);

	this._accum = 0;
	this._pc = 0;
}
mod_util.inherits(Calc, CT_model);
Calc.prototype.name = 'Calc';

Calc.prototype.init = function (arg)
{
	var self = this;
	var result;
	var infile;

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
	this._pc = 0;

	infile = mod_fs.createReadStream(arg.args[0]);
	infile.on('open', function () {
		result = {
			input: infile.pipe(new lstream()).pipe(new JSONStream())
		};
		arg.cb(result);
	});
	/* XXX need to handle inline errors too. */
	infile.on('error', function (err) {
		arg.cb({ err: err });
	});
};

Calc.prototype.exec = function (arg)
{
	var self = this;
	var insn;
	var result = {};

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.insn, 'arg.insn');
	mod_assert.func(arg.cb, 'arg.cb');

	insn = arg.insn;

	if (typeof (insn.op) !== 'string' ||
	    typeof (insn.value) !== 'number') {
		result.err = new VError('invalid action encountered: "%j"',
		    insn);
		setImmediate(arg.cb, result);
		return;
	}

	result.data = {
		pre: self._accum,
		pc: self._pc,
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

	result.data.post = self._accum;
	result.data.nextpc = ++self._pc;
	result.data.toString = function () {
		return (JSON.stringify(result.data));
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
