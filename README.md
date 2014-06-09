# Cloud Tycoon

Repository: <git@github.com:joyent/cloud-tycoon>
Browsing: <https://github.com/joyent/cloud-tycoon>
Who: Keith M Wesolowski
Docs: <https://mo.joyent.com/docs/cloud-tycoon>
Tickets/bugs: <https://devhub.joyent.com/jira/browse/TOOLS>


# Overview

This is documentation to be written later.

# Repository

    deps/           Git submodules and/or commited 3rd-party deps should go
                    here. See "node_modules/" for node.js deps.
    docs/           Project docs (restdown)
    lib/            Simulation toolkit libraries
    models/	    Simulation models
    node_modules/   External dependencies managed by npm
    test/           Test suite (using node-tap)
    tools/          Miscellaneous dev/upgrade/deployment tools and data.
    GNUmakefile
    package.json    npm module info (holds the project version)
    README.md


# Development

Do not use Github issues (they have been disabled for this repository).  Do not
submit pull requests.  Every change to this repository requires a bug or RFE
in the Jira database.

*Important*: There is at most one commit for each bug ID in this repository,
and the comment associated with that commit must be of the same form as in
illumos-joyent; that is:

TOOLS-9999 synopsis of bug from Jira

You may fix multiple bugs in a single commit; however, they should be
related either conceptually or have overlapping code changes.

Before pushing anything, run `gmake prepush` and, if possible, get a code
review.

# Testing

    gmake test

Which currently does nothing useful.  This section will be updated with more
detailed test information when available.
