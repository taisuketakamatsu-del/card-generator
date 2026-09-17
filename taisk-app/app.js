(() => {
  "use strict";

  const STORAGE_KEY = "taisk.tasks.v1";

  const BUCKETS = [
    { key: "today", label: "今日", dot: "dot-today" },
    { key: "week", label: "今週", dot: "dot-week" },
    { key: "month", label: "今月", dot: "dot-month" },
    { key: "later", label: "それ以降", dot: "dot-later" },
  ];

  const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function seedTasks() {
    return [
      { id: uid(), title: "資料を提出する", bucket: "today", pinned: true, done: false },
      { id: uid(), title: "メールを返信する", bucket: "today", pinned: false, done: false },
      { id: uid(), title: "会議の準備をする", bucket: "today", pinned: false, done: false },
      { id: uid(), title: "経費精算をする", bucket: "today", pinned: false, done: false },
      { id: uid(), title: "プロジェクト計画を見直す", bucket: "week", pinned: true, done: false },
      { id: uid(), title: "チームミーティングを設定する", bucket: "week", pinned: false, done: false },
      { id: uid(), title: "レポートを作成する", bucket: "week", pinned: false, done: false },
      { id: uid(), title: "四半期目標を設定する", bucket: "month", pinned: true, done: false },
      { id: uid(), title: "研修に参加する", bucket: "month", pinned: false, done: false },
      { id: uid(), title: "オフィス移転の計画", bucket: "later", pinned: false, done: false },
      { id: uid(), title: "システムのアップデート", bucket: "later", pinned: false, done: false },
    ];
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { /* ignore corrupt storage */ }
    const seeded = seedTasks();
    save(seeded);
    return seeded;
  }

  function save(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) { /* storage unavailable, continue in-memory */ }
  }

  let tasks = load();
  let openMenuId = null;
  let editingId = null;
  let lastDeleted = null;
  let toastTimer = null;

  const nowList = document.getElementById("nowList");
  const nowCountEl = document.getElementById("nowCount");
  const board = document.getElementById("board");
  const modalOverlay = document.getElementById("modalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const taskTitleInput = document.getElementById("taskTitleInput");
  const bucketPicker = document.getElementById("bucketPicker");
  const pinCheckbox = document.getElementById("pinCheckbox");
  const saveBtn = document.getElementById("saveBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const addBtn = document.getElementById("addBtn");
  const shareBtn = document.getElementById("shareBtn");
  const toast = document.getElementById("toast");

  let selectedBucket = "today";

  function persist() { save(tasks); }

  function showToast(message, actionLabel, actionFn) {
    clearTimeout(toastTimer);
    toast.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);
    if (actionLabel && actionFn) {
      const btn = document.createElement("button");
      btn.textContent = actionLabel;
      btn.style.cssText = "margin-left:12px;background:transparent;border:none;color:#a78bfa;font-weight:600;cursor:pointer;font-family:inherit;font-size:13.5px;";
      btn.addEventListener("click", () => {
        actionFn();
        toast.classList.remove("show");
      });
      toast.appendChild(btn);
    }
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 4000);
  }

  function closeMenus() {
    openMenuId = null;
    document.querySelectorAll(".row-menu").forEach((m) => m.remove());
    document.querySelectorAll(".more-btn.menu-open").forEach((b) => b.classList.remove("menu-open"));
  }

  function buildMenu(task) {
    const menu = document.createElement("div");
    menu.className = "row-menu";

    const editBtn = document.createElement("button");
    editBtn.textContent = "編集";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenus();
      openEditModal(task.id);
    });

    const pinBtn = document.createElement("button");
    pinBtn.textContent = task.pinned ? "いまやるから外す" : "いまやるに追加";
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      task.pinned = !task.pinned;
      persist();
      closeMenus();
      render();
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "削除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTask(task.id);
      closeMenus();
    });

    menu.appendChild(editBtn);
    menu.appendChild(pinBtn);
    menu.appendChild(delBtn);
    return menu;
  }

  function deleteTask(id) {
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    lastDeleted = { task: tasks[idx], index: idx };
    tasks.splice(idx, 1);
    persist();
    render();
    showToast("タスクを削除しました", "元に戻す", () => {
      if (!lastDeleted) return;
      tasks.splice(Math.min(lastDeleted.index, tasks.length), 0, lastDeleted.task);
      lastDeleted = null;
      persist();
      render();
    });
  }

  function toggleDone(id, rowEl) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.done = true;
    persist();
    if (rowEl) {
      rowEl.classList.add("done");
      setTimeout(render, 260);
    } else {
      render();
    }
  }

  function makeCheckCircle(task, rowEl) {
    const btn = document.createElement("button");
    btn.className = "check-circle";
    btn.innerHTML = CHECK_ICON;
    btn.title = "完了にする";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDone(task.id, rowEl);
    });
    return btn;
  }

  function makeMoreBtn(task) {
    const btn = document.createElement("button");
    btn.className = "more-btn";
    btn.textContent = "⋯";
    btn.title = "その他の操作";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = openMenuId === task.id;
      closeMenus();
      if (!isOpen) {
        openMenuId = task.id;
        btn.classList.add("menu-open");
        btn.parentElement.appendChild(buildMenu(task));
      }
    });
    return btn;
  }

  function renderNow() {
    const pinned = tasks.filter((t) => t.pinned && !t.done);
    nowCountEl.textContent = pinned.length;
    nowList.innerHTML = "";

    if (pinned.length === 0) {
      const empty = document.createElement("div");
      empty.className = "column-empty";
      empty.textContent = "いまやるタスクはありません。タスクの「⋯」から追加できます。";
      nowList.appendChild(empty);
      return;
    }

    pinned.forEach((task, i) => {
      const row = document.createElement("div");
      const rank = i + 1;
      row.className = "now-row" + (rank === 1 ? " rank-1" : "");
      // Rank shown purely by color intensity: brightest = highest priority.
      const opacity = Math.max(1 - i * 0.3, 0.28);
      row.style.setProperty("--rank-opacity", opacity.toFixed(2));
      row.title = `優先度 ${rank}`;
      row.addEventListener("click", () => openEditModal(task.id));

      const check = makeCheckCircle(task, row);
      const title = document.createElement("div");
      title.className = "task-title";
      title.textContent = task.title;
      const more = makeMoreBtn(task);

      row.appendChild(check);
      row.appendChild(title);
      row.appendChild(more);
      nowList.appendChild(row);
    });
  }

  function renderBoard() {
    board.innerHTML = "";
    BUCKETS.forEach((bucketDef) => {
      const items = tasks.filter((t) => t.bucket === bucketDef.key && !t.done);

      const col = document.createElement("div");
      col.className = "column";
      col.dataset.bucket = bucketDef.key;

      const header = document.createElement("div");
      header.className = "column-header";
      header.innerHTML = `<span class="dot ${bucketDef.dot}"></span><span class="column-title">${bucketDef.label}</span>`;
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = items.length;
      header.appendChild(badge);
      col.appendChild(header);

      const list = document.createElement("div");
      list.className = "column-list";

      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "column-empty";
        empty.textContent = "タスクなし";
        list.appendChild(empty);
      }

      items.forEach((task) => {
        const row = document.createElement("div");
        row.className = "task-row";
        row.draggable = true;
        row.dataset.id = task.id;

        row.addEventListener("dragstart", (e) => {
          row.classList.add("dragging");
          e.dataTransfer.setData("text/plain", task.id);
          e.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragend", () => row.classList.remove("dragging"));
        row.addEventListener("click", () => openEditModal(task.id));

        const check = makeCheckCircle(task, row);
        const title = document.createElement("div");
        title.className = "task-title";
        title.textContent = task.title;
        const more = makeMoreBtn(task);

        row.appendChild(check);
        row.appendChild(title);
        row.appendChild(more);
        list.appendChild(row);
      });

      col.appendChild(list);

      col.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        col.classList.add("drag-over");
      });
      col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        col.classList.remove("drag-over");
        const id = e.dataTransfer.getData("text/plain");
        const task = tasks.find((t) => t.id === id);
        if (task && task.bucket !== bucketDef.key) {
          task.bucket = bucketDef.key;
          persist();
          render();
        }
      });

      board.appendChild(col);
    });
  }

  function render() {
    renderNow();
    renderBoard();
  }

  function setSelectedBucket(bucketKey) {
    selectedBucket = bucketKey;
    bucketPicker.querySelectorAll(".bucket-opt").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.bucket === bucketKey);
    });
  }

  bucketPicker.querySelectorAll(".bucket-opt").forEach((btn) => {
    btn.addEventListener("click", () => setSelectedBucket(btn.dataset.bucket));
  });

  function openAddModal() {
    editingId = null;
    modalTitle.textContent = "新しいタスク";
    taskTitleInput.value = "";
    pinCheckbox.checked = false;
    deleteBtn.style.display = "none";
    saveBtn.textContent = "追加";
    setSelectedBucket("today");
    modalOverlay.classList.add("open");
    setTimeout(() => taskTitleInput.focus(), 30);
  }

  function openEditModal(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    editingId = id;
    modalTitle.textContent = "タスクを編集";
    taskTitleInput.value = task.title;
    pinCheckbox.checked = !!task.pinned;
    deleteBtn.style.display = "inline-block";
    saveBtn.textContent = "保存";
    setSelectedBucket(task.bucket);
    modalOverlay.classList.add("open");
    setTimeout(() => taskTitleInput.focus(), 30);
  }

  function closeModal() {
    modalOverlay.classList.remove("open");
    editingId = null;
  }

  function saveModal() {
    const title = taskTitleInput.value.trim();
    if (!title) {
      taskTitleInput.focus();
      return;
    }
    if (editingId) {
      const task = tasks.find((t) => t.id === editingId);
      if (task) {
        task.title = title;
        task.bucket = selectedBucket;
        task.pinned = pinCheckbox.checked;
      }
    } else {
      tasks.push({
        id: uid(),
        title,
        bucket: selectedBucket,
        pinned: pinCheckbox.checked,
        done: false,
      });
    }
    persist();
    closeModal();
    render();
  }

  addBtn.addEventListener("click", openAddModal);
  cancelBtn.addEventListener("click", closeModal);
  saveBtn.addEventListener("click", saveModal);
  deleteBtn.addEventListener("click", () => {
    if (editingId) {
      const id = editingId;
      closeModal();
      deleteTask(id);
    }
  });
  taskTitleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveModal();
  });
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (modalOverlay.classList.contains("open")) closeModal();
      closeMenus();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".more-btn") && !e.target.closest(".row-menu")) {
      closeMenus();
    }
  });

  function buildShareText() {
    const active = tasks.filter((t) => !t.done);
    const lines = ["【taisk】タスク一覧", ""];
    const pinned = active.filter((t) => t.pinned);
    if (pinned.length) {
      lines.push("■ いまやる");
      pinned.forEach((t) => lines.push(`- ${t.title}`));
      lines.push("");
    }
    BUCKETS.forEach((b) => {
      const items = active.filter((t) => t.bucket === b.key);
      if (!items.length) return;
      lines.push(`■ ${b.label}`);
      items.forEach((t) => lines.push(`- ${t.title}`));
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  async function shareTasks() {
    const text = buildShareText();
    if (navigator.share) {
      try {
        await navigator.share({ title: "taisk タスク一覧", text });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("タスク一覧をクリップボードにコピーしました");
    } catch (e) {
      showToast("コピーに失敗しました。ブラウザの権限をご確認ください");
    }
  }

  shareBtn.addEventListener("click", shareTasks);

  render();
})();
