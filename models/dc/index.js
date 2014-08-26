/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var CT_model = require('../../lib/CT_model.js');
var glue = require('./glue.js');

function
create(arg)
{
	return (new glue(arg));
}

CT_model.init_module({ module: module, create: create });
