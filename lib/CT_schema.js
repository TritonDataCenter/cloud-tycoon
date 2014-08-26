/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var sStringNonEmpty = {
	'type': 'string',
	'minLength': 1
};

var sStringRequiredNonEmpty = {
	'type': 'string',
	'required': true,
	'minLength': 1
};

var sBoolean = {
	'type': 'boolean'
};

var sPositiveInteger = {
	'type': 'integer',
	'minimum': 1
};

var sPositiveIntegerRequired = {
	'type': 'integer',
	'required': true,
	'minimum': 1
};

var sURIRequired = {
	'type': 'string',
	'format': 'uri',
	'required': true
};

var sDate = {
	'type': 'string',
	'format': 'date-time'
};

var sStringArray = {
	'type': 'array',
	'items': sStringNonEmpty
};

var sNullStringNonEmpty = {
	'type': [ sStringNonEmpty, 'null' ]
};

var sNullStringArray = {
	'type': [ sStringArray, 'null' ]
};

var sScmd = {
	'type': 'object',
	'additionalProperties': false,
	'properties': {
		'scmd': sStringRequiredNonEmpty,
		'addr': sNullStringNonEmpty,
		'args': sNullStringArray,
		'tag': sStringNonEmpty
	}
};

var sError = {
	'type': 'object',
	'additionalProperties': true,
	'properties': {
		'message': sStringRequiredNonEmpty
	}
};

var sANY = {
	'type': 'any'
};

var sANYArray = {
	'type': 'array',
	'items': sANY
};

var sScmdResult = {
	'type': 'object',
	'additionalProperties': false,
	'properties': {
		'err': sError,
		'done': sBoolean,
		'tag': sStringNonEmpty,
		'data': sANYArray,
		'messages': sStringArray
	}
};

exports.sScmd = sScmd;
exports.sScmdResult = sScmdResult;
