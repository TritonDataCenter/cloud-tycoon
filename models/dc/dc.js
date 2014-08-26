/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var mod_assert = require('assert-plus');

var mod_cn = require('./cn.js');
var mod_vm = require('./vm.js');

const DCE_SUCCESS = 0;
const DCE_CN_NOTEMPTY = 1;

function
DC(arg)
{
	var self = this;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.logger, 'arg.logger');

	self._dc_logger = arg.logger;

	self._dc_name = arg.name || 'irrelevant';
	self._dc_cns_by_uuid = {};
	self._dc_cnidx_by_uuid = {};
	self._dc_cns = [];
	self._dc_cnuuid_by_vmuuid = {};
}
DC.prototype.name = 'DC';

DC.prototype._log = function (arg)
{
	var self = this;

	mod_assert.object(arg, 'arg');
	mod_assert.string(arg.level, 'arg.level');
	mod_assert.optionalObject(arg.err, 'arg.err');
	mod_assert.optionalObject(arg.data, 'arg.data');
	mod_assert.optionalString(arg.msg, 'arg.msg');

	if (typeof (arg.data) === 'object') {
		self._dc_logger[arg.level](arg.data, arg.msg || undefined);
	} else if (typeof (arg.err) === 'object') {
		self._dc_logger[arg.level](arg.err, arg.msg || undefined);
	} else {
		self._dc_logger[arg.level](arg.msg);
	}
};

DC.prototype.add_cn = function (arg)
{
	var self = this;
	var cn_uuid;
	var cn_idx;
	var cn;

	mod_assert.object(arg, 'arg');

	if (typeof (arg.params) === 'object') {
		mod_assert.equal(typeof (arg.cn), 'undefined');
		arg.params.logger = self._dc_logger;
		cn = mod_cn.create(arg.params);
	} else {
		mod_assert.optionalObject(arg.cn, 'arg.cn');
		cn = arg.cn;
	}

	cn_uuid = cn.uuid();

	mod_assert.equal(typeof (self._dc_cns_by_uuid[cn_uuid]), 'undefined');
	mod_assert.equal(typeof (self._dc_cnidx_by_uuid[cn_uuid]), 'undefined');

	self._dc_cns_by_uuid[cn_uuid] = cn;
	cn_idx = self._dc_cns.push(cn) - 1;
	self._dc_cnidx_by_uuid[cn_uuid] = cn_idx;

	return (DCE_SUCCESS);
};

DC.prototype.remove_cn = function (arg)
{
	var self = this;
	var cn_idx;
	var cn;

	mod_assert.object(arg, 'arg');
	mod_assert.string(arg.uuid, 'arg.uuid');

	mod_assert.object(self._dc_cns_by_uuid[arg.uuid],
	    'self._dc_cns_by_uuid[arg.uuid]');
	mod_assert.number(self._dc_cnidx_by_uuid[arg.uuid],
	    'self._dc_cnidx_by_uuid[arg.uuid]');

	cn_idx = self._dc_cnidx_by_uuid[arg.uuid];
	cn = self._dc_cns_by_uuid[arg.uuid];

	if (cn.vmcount() !== 0)
		return (DCE_CN_NOTEMPTY);

	self._dc_cns.splice(cn_idx, 1);
	delete self._dc_cns_by_uuid[arg.uuid];
	delete self._dc_cnidx_by_uuid[arg.uuid];

	return (DCE_SUCCESS);
};

DC.prototype.cnapify = function ()
{
	var self = this;

	return (self._cns.map(function (cn) {
		return (cn.cnapify(self._dc_name));
	}));
};
