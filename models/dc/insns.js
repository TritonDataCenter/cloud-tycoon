/*
 * Valid VMAPI operations we act upon include:
 *
 * CreateVm
 * UpdateVm (resize, change ownership)
 * DeleteVm
 *
 * Everything else is treated as a nop.
 *
 * Old-style operations were:
 *
 * hvm_destroy
 * machine_create
 * zone_change_owner
 * zone_destroy
 * zone_resize
 *
 * Note that these were segregated between zones and VMs; today they're
 * unified.  There are therefore three possible sources for the information
 * in each pseudo-VMAPI call: VMAPI logs, workflow history dumps, and old
 * style workflow logs (used by the billing team).  Unfortunately none of
 * these contain the format we're going for, which is a streaming-JSON
 * series of VMAPI payloads.  Translators will be provided.
 *
 * It would be nice if the code to validate the input stream were unified
 * with VMAPI itself, just as it would be nice if the DC state tracking and
 * provisioning were unified with CNAPI.
 */

function
inst_create(arg)
{
}

function
inst_resize(arg)
{
}

function
inst_chown(arg)
{
}

function
inst_delete(arg)
{
}

module.exports = {
	create: inst_create,
	resize: inst_resize,
	chown: inst_chown,
	'delete': inst_delete
};
