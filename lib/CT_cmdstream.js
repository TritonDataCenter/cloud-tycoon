#! /opt/local/bin/node

/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var mod_assert = require('assert-plus');
var mod_stream = require('stream');
var mod_util = require('util');

var VError = require('verror');

/*
 * Break a possibly-quoted string into multiple arguments, similarly to how
 * a shell would.  The only accepted quoting character is ' and there is no
 * way to quote or escape '.  Tough.
 */
function
parse_args(arg)
{
	var str;
	var args = new Array();
	var i;
	var s;
	var start;
	var qstart = -1;
	var in_quote = false;

	mod_assert.object(arg, 'arg');
	mod_assert.string(arg.args, 'args');

	str = arg.args;

	if (str.indexOf('\'') === -1) {
		args = str.split(/\s+/);
		return ({ args: args });
	}

	for (start = i = 0; i < str.length; i++) {
		if (in_quote) {
			if (str.charAt(i) === '\'') {
				qstart = -1;
				in_quote = false;
			}
			continue;
		}

		if (str.charAt(i) === '\'') {
			in_quote = true;
			qstart = i;
			continue;
		}

		if (str.charAt(i) === ' ' || str.charAt(i) === '\t') {
			if (i > start) {
				s = str.substr(start, i - start);

				args.push(s.replace(/'/g, ''));
			}

			while (str.charAt(i + 1) === ' ' ||
			    str.charAt(i + 1) === '\t') {
				++i;
			}
			start = i + 1;
		}
	}

	if (in_quote) {
		return ({
			err: new VError('parse error: unterminated \' at %d',
			    qstart)
		});
	}

	if (start < i) {
		s = str.substr(start, i - start);

		args.push(s.replace(/'/g, ''));
	}

	return ({ args: args });
}

function
parse_cmd(arg)
{
	var cmd;
	var res = {};
	var cmdargs;
	var line;
	var args;

	mod_assert.object(arg, 'arg');
	mod_assert.string(arg.line, 'arg.line');

	line = arg.line;
	cmd = new Object();

	/*
	 * This is a VERY simple mdb-like parser.  It supports the following
	 * basic input formats:
	 *
	 * [<addr>]::<command> [...]
	 * <addr>/<formatchar> [...]
	 * <addr>=<formatchar> [...]
	 * :<commandchar> [...]
	 * $<commandchar> [...]
	 *
	 * Anything that doesn't match this will result in an error.
	 */
	cmdargs = line.match(/^([^: ]*)::(\S+)\s*(.*)$/);
	if (cmdargs) {
		if (cmdargs[1])
			cmd.addr = cmdargs[1];
		else
			cmd.addr = null;
		cmd.scmd = cmdargs[2];
		if (cmdargs[3]) {
			args = parse_args({ args: cmdargs[3] });
			if (typeof (args.err) !== 'undefined') {
				res.err = new VError(args.err,
				    'failed to parse scmd arguments');
			} else {
				cmd.args = args.args;
			}
		} else {
			cmd.args = null;
		}

		if (typeof (res.err) === 'undefined')
			res.cmd = cmd;

		return (res);
	}

	/* JSSTYLED */
	cmdargs = line.match(/^([0-9a-zA-Z_]+)([/=])([a-zA-Z])\s*(.*)$/);
	if (cmdargs) {
		cmd.addr = cmdargs[1];
		cmd.deref = (cmdargs[2] === '/') ? true : false;
		cmd.format = cmdargs[3];
		if (cmdargs[4]) {
			args = parse_args({ args: cmdargs[4] });
			if (typeof (args.err) !== 'undefined') {
				res.err = new VError(args.err,
				    'failed to parse format arguments');
			} else {
				cmd.args = args.args;
			}
		} else {
			cmd.args = null;
		}

		if (typeof (res.err) === 'undefined')
			res.cmd = cmd;

		return (res);
	}

	cmdargs = line.match(/^([:$][a-zA-Z])\s*(.*)$/);
	if (cmdargs) {
		cmd.scmd = cmdargs[1];
		if (cmdargs[2]) {
			args = parse_args({ args: cmdargs[2] });
			if (typeof (args.err) !== 'undefined') {
				res.err = new VError(args.err,
				    'failed to parse short scmd arguments');
			} else {
				cmd.args = args.args;
			}
		} else {
			cmd.args = null;
		}

		if (typeof (res.err) === 'undefined')
			res.cmd = cmd;

		return (res);
	}

	res.err = new VError('failed to parse command line');

	return (res);
}

function
CT_cmdstream(arg)
{
	var stropts;

	mod_assert.object(arg, 'arg');
	mod_assert.optionalObject(arg.stropts, 'arg.stropts');
	stropts = arg.stropts || {};

	stropts.decodeStrings = false;
	stropts.highWaterMark = 0;

	mod_stream.Transform.call(this, stropts);
	this._writableState.objectMode = false;
	this._readableState.objectMode = true;
}
mod_util.inherits(CT_cmdstream, mod_stream.Transform);
CT_cmdstream.prototype.name = 'CT_cmdstream';

CT_cmdstream.prototype._transform = function (str, __ignored, done)
{
	var self = this;
	var line;
	var res;

	line = str.trim();

	if (line === '') {
		setImmediate(done);
		return;
	}

	res = parse_cmd({ line: line });
	if (typeof (res.err) !== 'undefined') {
		setImmediate(done, res.err);
		return;
	}

	if (typeof (res.cmd) === 'object')
		self.push(res.cmd);

	setImmediate(done);
};

module.exports = CT_cmdstream;
