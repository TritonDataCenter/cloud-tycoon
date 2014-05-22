#! /opt/local/bin/node

/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var CT_simulation = require('../lib/CT_simulation.js');
var CT_session = require('../lib/CT_session.js');

function
scmd_quit_hdlr(arg)
{
	process.exit(0);
}

function
main()
{
	var nexus;
	var session = new CT_session();
	var sim = new CT_simulation({});

	sim.register_scmd({
		str: 'quit',
		aliases: [ '$q' ],
		handler: scmd_quit_hdlr,
		synopsis: 'terminate the simulation and quit'
	});

	if (process.argv.length > 2) {
		sim.inject_ctl({
			cmd: {
				scmd: 'attach',
				args: [ process.argv[2] ]
			}
		});
	}

	nexus = {
		ctlin: process.stdin,
		ctlout: process.stdout,
		ctlerr: process.stderr,
		simout: process.stdout,
		simerr: process.stderr,
		simulation: sim
	};

	session.start(nexus);
}

main();
