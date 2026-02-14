---- MODULE ApprovalAnyAll ----
EXTENDS Naturals

TaskState == {"PENDING", "APPROVED", "REJECTED", "SKIPPED", "CANCELLED"}
ReqState == {"IN_REVIEW", "APPROVED", "REJECTED"}

VARIABLES reqState, taskA, taskB, completionCount
vars == <<reqState, taskA, taskB, completionCount>>

Init ==
  /\ reqState = "IN_REVIEW"
  /\ taskA = "PENDING"
  /\ taskB = "PENDING"
  /\ completionCount = 0

ApproveA ==
  /\ reqState = "IN_REVIEW"
  /\ taskA = "PENDING"
  /\ reqState' = "APPROVED"
  /\ taskA' = "APPROVED"
  /\ taskB' = IF taskB = "PENDING" THEN "SKIPPED" ELSE taskB
  /\ completionCount' = completionCount + 1

ApproveB ==
  /\ reqState = "IN_REVIEW"
  /\ taskB = "PENDING"
  /\ reqState' = "APPROVED"
  /\ taskB' = "APPROVED"
  /\ taskA' = IF taskA = "PENDING" THEN "SKIPPED" ELSE taskA
  /\ completionCount' = completionCount + 1

RejectA ==
  /\ reqState = "IN_REVIEW"
  /\ taskA = "PENDING"
  /\ reqState' = "REJECTED"
  /\ taskA' = "REJECTED"
  /\ taskB' = IF taskB = "PENDING" THEN "CANCELLED" ELSE taskB
  /\ completionCount' = completionCount

RejectB ==
  /\ reqState = "IN_REVIEW"
  /\ taskB = "PENDING"
  /\ reqState' = "REJECTED"
  /\ taskB' = "REJECTED"
  /\ taskA' = IF taskA = "PENDING" THEN "CANCELLED" ELSE taskA
  /\ completionCount' = completionCount

Stutter ==
  /\ UNCHANGED vars

Next ==
  \/ ApproveA
  \/ ApproveB
  \/ RejectA
  \/ RejectB
  \/ Stutter

Spec == Init /\ [][Next]_vars

NoDoubleCompletion ==
  completionCount <= 1

NoContradictoryTerminal ==
  ~(reqState = "APPROVED" /\ reqState = "REJECTED")

NoPendingAfterTerminal ==
  (reqState \in {"APPROVED", "REJECTED"}) =>
    ~(taskA = "PENDING" \/ taskB = "PENDING")

Invariant ==
  /\ NoDoubleCompletion
  /\ NoContradictoryTerminal
  /\ NoPendingAfterTerminal

====
