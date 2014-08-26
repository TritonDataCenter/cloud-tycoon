/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var mod_assert = require('assert-plus');

function
VM(arg)
{
	var self = this;

	self._vm_dram_mb = arg.dram_mb;
	self._vm_cpu_cap = arg.cpu_cap;
	self._vm_quota = arg.quota;
	self._vm_owner = arg.owner;
	self._vm_vcpus = arg.vcpus || 0;
	self._vm_disks = arg.disks || [];
	self._vm_networks = arg.networks;
	self._vm_traits = arg.traits || {};
	self._vm_brand = arg.brand;

	/* XXX image, package not really used */

	self._vm_cn = null;
}
VM.prototype.name = 'VM';

VM.prototype.uuid = function ()
{
	var self = this;

	return (self._vm_uuid);
};

VM.prototype.cnapify = function ()
{
	var self = this;
	var cvm;

	cvm = {
		uuid: self._vm_uuid,
		owner_uuid: self._vm_owner,
		quota: self._quota,
		max_physical_memory: self._vm_dram_mb,
		zone_state: 'running',
		state: 'running',
		brand: self._vm_brand,
		cpu_cap: self._vm_cpu_cap,
		last_modified: (new Date()).toISOString()
	};

	return (cvm);
};

VM.prototype.is_kvm = function ()
{
	var self = this;

	return (self._vm_brand === 'kvm');
};

VM.prototype.dram_mb = function ()
{
	var self = this;

	return (self._vm_dram_mb);
};

VM.prototype.cpus = function ()
{
	var self = this;

	return (self._vm_cpu_cap);
};

VM.prototype.disk_mb = function ()
{
	var self = this;
	var used = 0;

	if (self._vm_brand === 'kvm') {
		used = 10 * 1024 + self._vm_disks.reduce(function (prev, disk) {
			return (prev + disk.size);
		}, 0);
	} else {
		used = self._vm_quota;
	}

	return (used);
};

VM.prototype.total_zvol_size = function ()
{
	var self = this;

	if (self._vm_brand !== 'kvm')
		return (0);

	return (self._vm_disks.reduce(function (prev, disk) {
		return (prev + disk.size);
	}, 0));
};

VM.prototype.disk_quota = function ()
{
	var self = this;

	return (self._vm_quota);
};
