# Cloud Tycoon

Repository: <git@git.joyent.com:cloud-tycoon.git>
Browsing: <https://mo.joyent.com/cloud-tycoon>
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

Before commiting/pushing run `make prepush` and, if possible, get a code
review.



# Testing

    gmake test

If you project has setup steps necessary for testing, then describe those
here.
