/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
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
