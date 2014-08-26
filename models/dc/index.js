/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var CT_model = require('../../lib/CT_model.js');
var glue = require('./glue.js');

function
create(arg)
{
	return (new glue(arg));
}

CT_model.init_module({ module: module, create: create });
