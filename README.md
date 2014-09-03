<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# Cloud Tycoon

This repository is part of the Joyent SmartDataCenter project (SDC).  For 
contribution guidelines, issues, and general documentation, visit the main
[SDC](http://github.com/joyent/sdc) project page.

Cloud Tycoon is a general-purpose time series simulation engine,
intended for use with sdc-designation to simulate the effects of
provisioning algorithm changes on a data centre.

# Development

Do not use Github issues (they have been disabled for this repository).
Do not submit pull requests.  Every change to this repository requires a
bug or RFE in the Jira database.

*Important*: There is at most one commit for each bug ID in this
repository, and the comment associated with that commit must be of the
same form as in illumos-joyent; that is:

TOOLS-9999 synopsis of bug from Jira

You may fix multiple bugs in a single commit; however, they should be
related either conceptually or have overlapping code changes.

Before pushing anything, run `gmake prepush` and, if possible, get a
code review.
