const statusEl = document.getElementById('status');
const tenantEl = document.getElementById('tenant-id');
const userEl = document.getElementById('user-id');
const rolesEl = document.getElementById('roles');

const requestForm = document.getElementById('request-form');
const requestIdEl = document.getElementById('request-id');
const requestTypeEl = document.getElementById('request-type');
const requestTitleEl = document.getElementById('request-title');
const requestAmountEl = document.getElementById('request-amount');
const requestCurrencyEl = document.getElementById('request-currency');
const requestDescriptionEl = document.getElementById('request-description');
const requestsBodyEl = document.getElementById('requests-body');
const tasksBodyEl = document.getElementById('tasks-body');
const auditListEl = document.getElementById('audit-list');

function setStatus(message, isError = false) {
  statusEl.className = `status ${isError ? 'err' : 'ok'}`;
  statusEl.textContent = message;
}

function actorHeaders() {
  return {
    'x-tenant-id': tenantEl.value.trim(),
    'x-user-id': userEl.value.trim(),
    'x-roles': rolesEl.value.trim(),
    'content-type': 'application/json'
  };
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: actorHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.message || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json;
}

function resetRequestForm() {
  requestIdEl.value = '';
  requestTypeEl.value = 'GENERIC';
  requestTitleEl.value = '';
  requestAmountEl.value = '10000';
  requestCurrencyEl.value = 'JPY';
  requestDescriptionEl.value = '';
}

function toMoney(value) {
  return Number(value || 0).toLocaleString('ja-JP');
}

function decideControls(taskId) {
  const wrap = document.createElement('div');
  wrap.className = 'row-actions';
  const comment = document.createElement('input');
  comment.placeholder = 'comment';
  comment.style.width = '140px';

  const actions = [
    ['APPROVE', 'Approve'],
    ['RETURN', 'Return'],
    ['REJECT', 'Reject']
  ];

  actions.forEach(([decision, label]) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.type = 'button';
    btn.textContent = label;
    btn.onclick = async () => {
      try {
        await api('POST', `/api/v1/tasks/${taskId}/decide`, {
          decision,
          comment: comment.value.trim() || undefined
        });
        setStatus(`task ${taskId} を ${decision} しました`);
        await refreshAll();
      } catch (error) {
        setStatus(error.message, true);
      }
    };
    wrap.append(btn);
  });

  wrap.append(comment);
  return wrap;
}

function requestControls(requestItem) {
  const wrap = document.createElement('div');
  wrap.className = 'row-actions';

  const actions = [
    ['編集', async () => {
      requestIdEl.value = requestItem.requestId;
      requestTypeEl.value = requestItem.type;
      requestTitleEl.value = requestItem.title;
      requestAmountEl.value = String(requestItem.amount);
      requestCurrencyEl.value = requestItem.currency;
      requestDescriptionEl.value = requestItem.description || '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }],
    ['提出', async () => {
      await api('POST', `/api/v1/requests/${requestItem.requestId}/submit`, {});
    }],
    ['取下げ', async () => {
      await api('POST', `/api/v1/requests/${requestItem.requestId}/withdraw`, {});
    }],
    ['取消', async () => {
      await api('POST', `/api/v1/requests/${requestItem.requestId}/cancel`, {});
    }]
  ];

  actions.forEach(([label, fn]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost';
    btn.textContent = label;
    btn.onclick = async () => {
      try {
        await fn();
        setStatus(`${requestItem.requestId} の操作 ${label} が完了しました`);
        await refreshAll();
      } catch (error) {
        setStatus(error.message, true);
      }
    };
    wrap.append(btn);
  });

  return wrap;
}

async function refreshRequests() {
  const list = await api('GET', '/api/v1/requests');
  requestsBodyEl.innerHTML = '';
  list.forEach((requestItem) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${requestItem.requestId}</td>
      <td>${requestItem.status}</td>
      <td>${requestItem.title}</td>
      <td>${toMoney(requestItem.amount)} ${requestItem.currency}</td>
      <td></td>
    `;
    tr.children[4].append(requestControls(requestItem));
    requestsBodyEl.append(tr);
  });
}

async function refreshTasks() {
  const list = await api('GET', '/api/v1/tasks?status=PENDING');
  tasksBodyEl.innerHTML = '';
  list.forEach((task) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${task.taskId}</td>
      <td>${task.requestId} / ${task.stepId}</td>
      <td>${task.assigneeUserId}</td>
      <td></td>
    `;
    tr.children[3].append(decideControls(task.taskId));
    tasksBodyEl.append(tr);
  });
}

async function refreshAudit() {
  const list = await api('GET', '/api/v1/audit-logs');
  auditListEl.innerHTML = '';
  list
    .slice(-20)
    .reverse()
    .forEach((item) => {
      const li = document.createElement('li');
      li.className = 'audit-item';
      li.textContent = `${item.createdAt} ${item.action} actor=${item.actorUserId} request=${item.requestId || '-'}`;
      auditListEl.append(li);
    });
}

async function refreshAll() {
  await Promise.all([refreshRequests(), refreshTasks(), refreshAudit()]);
}

async function seedDemo() {
  const originalUser = userEl.value;
  const originalRoles = rolesEl.value;
  try {
    userEl.value = 'admin-01';
    rolesEl.value = 'ADMIN';

    await api('POST', '/api/v1/org-relations', {
      userId: 'approver-a',
      managerUserId: null,
      roles: ['DEPT_HEAD']
    });
    await api('POST', '/api/v1/org-relations', {
      userId: 'approver-b',
      managerUserId: null,
      roles: ['DEPT_HEAD']
    });
    await api('POST', '/api/v1/org-relations', {
      userId: 'finance-01',
      managerUserId: null,
      roles: ['FINANCE']
    });

    const wfId = 'wf-ui-default';
    try {
      await api('POST', '/api/v1/workflows', {
        workflowId: wfId,
        name: 'UI Default Workflow',
        matchCondition: { priority: 100 },
        steps: [
          { stepId: 'step-1', name: 'Dept', mode: 'ANY', approverSelector: 'ROLE:DEPT_HEAD' },
          { stepId: 'step-2', name: 'Finance', mode: 'ALL', approverSelector: 'ROLE:FINANCE' }
        ]
      });
    } catch (error) {
      if (!String(error.message).includes('already exists')) {
        throw error;
      }
    }
    await api('POST', `/api/v1/workflows/${wfId}/activate`, {});

    setStatus('デモ初期化が完了しました。requester/approver を切替して運用できます。');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    userEl.value = originalUser;
    rolesEl.value = originalRoles;
    await refreshAll().catch(() => {});
  }
}

document.getElementById('btn-refresh').onclick = async () => {
  try {
    await refreshAll();
    setStatus('再読込が完了しました。');
  } catch (error) {
    setStatus(error.message, true);
  }
};

document.getElementById('btn-seed').onclick = () => {
  void seedDemo();
};

document.getElementById('btn-reset-request').onclick = () => {
  resetRequestForm();
};

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = {
      type: requestTypeEl.value,
      title: requestTitleEl.value.trim(),
      amount: Number(requestAmountEl.value),
      currency: requestCurrencyEl.value.trim(),
      description: requestDescriptionEl.value.trim() || null
    };

    if (requestIdEl.value) {
      await api('PATCH', `/api/v1/requests/${requestIdEl.value}`, payload);
      setStatus(`request ${requestIdEl.value} を更新しました`);
    } else {
      await api('POST', '/api/v1/requests', payload);
      setStatus('新規申請を作成しました');
    }
    resetRequestForm();
    await refreshAll();
  } catch (error) {
    setStatus(error.message, true);
  }
});

void refreshAll().catch((error) => setStatus(error.message, true));
