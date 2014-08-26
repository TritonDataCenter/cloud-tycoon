/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var mod_assert = require('assert-plus');
var mod_util = require('util');
var mod_uuid = require('node-uuid');

function
CN(arg)
{
	var self = this;
	var uuid;

	mod_assert.object(arg, 'arg');
	mod_assert.number(arg.dram_mb, 'arg.dram_mb');
	mod_assert.number(arg.cpus, 'arg.cpus');
	mod_assert.number(arg.disk_mb, 'arg.disk_mb');
	mod_assert.optionalNumber(arg.dram_reserve, 'arg.dram_reserve');
	mod_assert.optionalArrayOfObject(arg.nics, 'arg.nics');
	mod_assert.optionalObject(arg.traits, 'arg.traits');

	uuid = arg.uuid || mod_uuid.v4();

	self._cn_uuid = uuid;
	self._cn_vms_by_uuid = {};
	self._cn_vmidx_by_uuid = {};
	self._cn_vms = [];
	self._cn_dram_mb = arg.dram_mb;
	self._cn_nics = arg.nics || [];
	self._cn_cpus = arg.cpus;
	self._cn_disk_mb = arg.disk_mb;
	self._cn_traits = arg.traits || {};

	if (typeof (arg.dram_reserve) === 'number')
		self._cn_dram_reserve = arg.dram_reserve;
	else
		self._cn_dram_reserve = 0;

	self._cn_dram_av_mb = self._cn_dram_mb * (1 - self._cn_dram_reserve);
	self._cn_cpus_av = self._cn_cpus;
	self._cn_disk_av_mb = self._cn_disk_mb;
}
CN.prototype.name = 'CN';

CN.prototype.add_vm = function (arg)
{
	var self = this;
	var vm_uuid;
	var vm_idx;

	mod_assert.object(arg, 'arg');
	mod_assert.object(arg.vm, 'arg.vm');

	vm_uuid = arg.vm.uuid();

	/*
	 * The only thing we're going to check for here is an internal
	 * error; i.e., the VM already exists here.  We do not check for
	 * provisioning errors here because that's a matter of policy.  If
	 * this provision is wrong because of trait mismatch or inadequate
	 * resources, we don't care.  This can therefore be used to model
	 * operator-initiated provisions, which do in fact bypass all these
	 * checks.
	 */
	mod_assert.equal(typeof (self._cn_vms_by_uuid[vm_uuid]), 'undefined');
	mod_assert.equal(typeof (self._cn_vmidx_by_uuid[vm_uuid]), 'undefined');

	self._cn_vms_by_uuid[vm_uuid] = arg.vm;
	vm_idx = self._cn_vms.push(arg.vm) - 1;
	self._cn_vmidx_by_uuid[vm_uuid] = vm_idx;

	self._cn_dram_av_mb -= arg.vm.dram_mb();
	self._cn_cpus_av -= arg.vm.cpus();
	self._cn_disk_av_mb -= arg.vm.disk_mb();
};

CN.prototype.remove_vm = function (arg)
{
	var self = this;
	var vm_idx;
	var vm;

	mod_assert.object(arg, 'arg');
	mod_assert.string(arg.uuid, 'arg.uuid');

	mod_assert.object(self._cn_vms_by_uuid[arg.uuid],
	    'self._cn_vms_by_uuid[arg.uuid]');
	mod_assert.number(self._cn_vmidx_by_uuid[arg.uuid],
	    'self._cn_vmidx_by_uuid[arg.uuid]');

	vm_idx = self._cn_vmidx_by_uuid[arg.uuid];
	vm = self._cn_vmidx_by_uuid[arg.uuid];
	self._cn_vms.splice(vm_idx, 1);
	delete self._cn_vms_by_uuid[arg.uuid];
	delete self._cn_vmidx_by_uuid[arg.uuid];

	self._cn_dram_av_mb += vm.dram_mb();
	self._cn_cpus_av += vm.cpus();
	self._cn_disk_av_mb += vm.disk_mb();
};

CN.prototype.uuid = function ()
{
	var self = this;

	return (self._cn_uuid);
};

CN.prototype.vmcount = function ()
{
	var self = this;

	return (self._cn_vms.length);
};

CN.prototype.kvm_zvol_volsize_bytes = function ()
{
	var self = this;

	return (self._cn_vms.reduce(function (a, vm) {
		return (a + (vm.is_kvm() ? vm.total_zvol_size() : 0));
	}, 0));
};

CN.prototype.zone_quota_bytes = function ()
{
	var self = this;

	return (self._cn_vms.reduce(function (a, vm) {
		return (a + (vm.is_kvm() ? 0 : vm.disk_quota()));
	}, 0));
};

CN.prototype.cnapify = function (arg)
{
	var self = this;
	var cs;
	var cs_si;
	var cs_vms;
	var now = (new Date()).toISOString();

	cs_si = {
		'Live Image': 'irrelevant',
		'System Type': 'SunOS',
		'Boot Time': now,
		'Datacenter Name': arg.dcname || 'irrelevant',
		'SDC Version': '7.0',
		'Manufacturer': 'irrelevant',
		'Product': 'irrelevant',
		'Serial Number': 'irrelevant',
		'SKU Number': 'irrelevant',
		'HW Version': 'irrelevant',
		'HW Family': 'irrelevant',
		'Setup': true,
		'VM Capable': true,
		'CPU Type': 'irrelevant',
		'CPU Virtualization': 'vmx',
		'CPU Physical Cores': 2,
		'UUID': self._cn_uuid,
		'Hostname': self._cn_uuid,
		'CPU Total Cores': self._cn_cpus,
		'MiB of Memory': self._cn_dram_mb,
		'Zpool': 'zones',
		'Zpool Disks': 'c0t0d0s0',
		'Zpool Profile': 'stripe',
		'Zpool Creation': now,
		'Zpool Size in GiB': self._cn_disk_mb >>> 10,
		'Disks': { 'c0t0d0':
		    { 'Size in GB': self._cn_disk_mb >>> 10 } },
		'Boot Parameters': {},
		'SDC Agents': {},
		'Network Interfaces': {
			'nic0': {
				'Link Status': 'up',
				'NIC Names': [ 'external' ]
			}
		},
		'Virtual Network Interfaces': {
			'external0': {
				'Link Status': 'up'
			}
		},
		'Link Aggregations': {}
	};

	self._cn_vms.forEach(function (vm) {
		cs_vms[vm.uuid()] = vm.cnapify();
	});

	cs = {
		boot_params: {},
		boot_platform: self._cn_platform,
		current_platform: self._cn_platform,
		comments: '',
		created: self._cn_created,
		datacenter: self._cn_dc,
		default_console: 'serial',
		disk_cores_quota_bytes: 10 * 1024 * 1048576,
		disk_installed_images_used_bytes: 1,
		disk_kvm_quota_bytes: 10 * 1024 * 1048576 * self.vmcount(),
		disk_kvm_zvol_used_bytes: 0,
		disk_kvm_zvol_volsize_bytes: self.zvol_volsize_bytes(),
		disk_pool_size_bytes: self._cn_disk_mb * 1048576,
		disk_zone_quota_bytes: self.zone_quota_bytes(),
		headnode: false,
		hostname: self._cn_uuid,
		kernel_flags: {},
		last_boot: now,
		last_heartbeat: now,
		memory_arc_bytes: 0,
		memory_available_bytes: 0,
		memory_provisionable_bytes: self._cn_dram_av_mb * 1048576,
		memory_total_bytes: self._cn_dram_mb * 1048576,
		overprovision_ratio: 1.0,
		overprovision_ratios: {
			ram: 1.0,
			disk: 1.0,
			cpu: 1.0,
			io: 1.0,
			net: 1.0
		},
		rack_identifier: 'single_rack',
		ram: self._cn_dram_mb,
		reservation_ratio: self._cn_dram_reserve,
		reserved: false,
		reservoir: false,
		serial: self._cn_uuid,
		setting_up: false,
		setup: true,
		status: 'running',
		sysinfo: cs_si,
		traits: self._cn_traits,
		transitional_status: '',
		unreserved_cpu: self._cn_cpus_av,
		unreserved_disk: self._cn_disk_av_mb,
		unreserved_ram: self._cn_dram_av_mb,
		uuid: self._cn_uuid,
		vms: cs_vms
	};

	return (cs);
};

function
create(arg)
{
	return (new CN(arg));
}

module.exports = {
	create: create
};
