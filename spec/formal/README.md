# Formal Models for Approval Workflow

This directory contains lightweight formal models for acceptance criteria around
ANY/ALL approval behavior.

- `ApprovalAnyAll.tla`: TLA+ model to represent concurrent approve/reject decisions.
- `approval-any-all.cspm`: CSP model for quick static check in cspx subset.

The automation runner `scripts/ae/run.sh` prefers these files when present.
