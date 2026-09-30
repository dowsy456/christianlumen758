/* media/uploads: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.clampNum = function (n, min, max, fallback = min) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, x));
};
App.isUploadAbortError = function (err) {
  return !!(err?.name === "AbortError" || err?.code === "UPLOAD_ABORTED" || /upload aborted|aborted/i.test(String(err?.message || "")));
};
App.createUploadAbortError = function (reason = "upload aborted") {
  const err = new Error(reason);
  err.name = "AbortError";
  err.code = "UPLOAD_ABORTED";
  return err;
};
App.throwIfUploadAborted = function (signal) {
  if (signal?.aborted) throw App.createUploadAbortError(signal.reason || "upload aborted");
};
App.formatUploadPercentText = function (value) {
  const n = Number(value);
  const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  return `${pct.toFixed(2).padStart(5, "0")}%`;
};
App.calcUploadPercent = function (done, total) {
  const d = Math.max(0, Number(done) || 0);
  const t = Math.max(0, Number(total) || 0);
  if (!t) return 100;
  return Math.max(0, Math.min(100, d / t * 100));
};
App.dataURLPrefixForBlob = function (blob) {
  return `data:${String(blob?.type || "application/octet-stream")};base64,`;
};
App.dataURLCharLengthForBlob = function (blob) {
  const size = Math.max(0, Number(blob?.size || 0));
  return App.dataURLPrefixForBlob(blob).length + Math.ceil(size / 3) * 4;
};
App.countDataURLChunksForBlob = function (blob) {
  return Math.max(1, Math.ceil(App.dataURLCharLengthForBlob(blob) / App.RTDB_DATA_CHUNK_SIZE));
};
App.arrayBufferToBase64 = function (buffer) {
  const bytes = new Uint8Array(buffer || 0);
  let binary = "";
  const stride = 0x8000;
  for (let i = 0; i < bytes.length; i += stride) {
    const chunk = bytes.subarray(i, i + stride);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
};
App.readBlobSliceAsBase64 = async function (blob, start, end, signal) {
  App.throwIfUploadAborted(signal);
  const buffer = await blob.slice(start, end).arrayBuffer();
  App.throwIfUploadAborted(signal);
  return App.arrayBufferToBase64(buffer);
};
App.stripChunkedField = function (record, fieldName) {
  const out = {
    ...(record || {})
  };
  delete out[fieldName];
  for (let i = 2;; i++) {
    const key = `${fieldName}${i}`;
    if (!(key in out)) break;
    delete out[key];
  }
  return out;
};
App.readChunkedField = function (record, fieldName) {
  if (!record || typeof record !== "object") return "";
  const first = record[fieldName];
  if (typeof first !== "string") return "";
  let out = first;
  for (let i = 2;; i++) {
    const part = record[`${fieldName}${i}`];
    if (typeof part !== "string") break;
    out += part;
  }
  return out;
};
App.writeChunkedField = function (record, fieldName, value) {
  const out = App.stripChunkedField(record, fieldName);
  const s = String(value || "");
  if (!s) {
    out[fieldName] = "";
    return out;
  }
  let idx = 0;
  for (let i = 0; i < s.length; i += App.RTDB_DATA_CHUNK_SIZE) {
    const part = s.slice(i, i + App.RTDB_DATA_CHUNK_SIZE);
    out[idx === 0 ? fieldName : `${fieldName}${idx + 1}`] = part;
    idx += 1;
  }
  return out;
};
App.countChunkedPartsForValue = function (value) {
  const s = String(value || "");
  return Math.max(1, Math.ceil(s.length / App.RTDB_DATA_CHUNK_SIZE));
};
App.hasAllChunkedFieldParts = function (record, fieldName, expectedCount) {
  const total = Math.max(1, Number(expectedCount || 0));
  for (let i = 1; i <= total; i++) {
    const key = i === 1 ? fieldName : `${fieldName}${i}`;
    if (typeof record?.[key] !== "string") return false;
  }
  return true;
};
App.attachmentHasPendingChunkedData = function (file) {
  if (!file || typeof file !== "object") return false;
  const expectedCount = Math.max(1, Number(file.dataChunkCount || 0));
  const hasAllParts = App.hasAllChunkedFieldParts(file, "dataURL", expectedCount);
  const existingDataURL = hasAllParts ? App.readChunkedField(file, "dataURL") || String(file.dataURL || "") : String(file.dataURL || "");
  if (hasAllParts && existingDataURL) return false;
  if (Number(file.uploadPending || 0) > 0) return true;
  return !hasAllParts || !existingDataURL;
};
App.messageHasPendingChunkedMedia = function (msg) {
  if (!msg || typeof msg !== "object") return false;
  const groups = [];
  if (Array.isArray(msg.files)) groups.push(msg.files);
  for (const list of groups) {
    for (const file of list) {
      if (App.attachmentHasPendingChunkedData(file)) return true;
    }
  }
  return false;
};
App.normalizeChunkedAttachment = function (file) {
  if (!file || typeof file !== "object") return file;
  const out = App.stripChunkedField(file, "dataURL");
  const expectedCount = Math.max(1, Number(file.dataChunkCount || 0));
  const hasAllParts = App.hasAllChunkedFieldParts(file, "dataURL", expectedCount);
  const assembledDataURL = hasAllParts ? App.readChunkedField(file, "dataURL") : "";

  // The initial message record contains dataURL:"" as a one-part placeholder.
  // It is not committed media until at least one non-empty data URL part exists.
  if (hasAllParts && assembledDataURL) {
    out.dataURL = assembledDataURL;
    delete out.previewURL;
    delete out.__loading;
    delete out.uploadPending;
    delete out.uploadProgress;
    delete out.dataChunkCount;
  }
  return out;
};
App.splitChunkedFieldEntries = function (fieldName, value) {
  const s = String(value || "");
  if (!s) return [[fieldName, ""]];
  const entries = [];
  let idx = 0;
  for (let i = 0; i < s.length; i += App.RTDB_DATA_CHUNK_SIZE) {
    const key = idx === 0 ? fieldName : `${fieldName}${idx + 1}`;
    entries.push([key, s.slice(i, i + App.RTDB_DATA_CHUNK_SIZE)]);
    idx += 1;
  }
  return entries;
};
App.runTaskPool = async function (taskFns, limit = 1) {
  const total = Array.isArray(taskFns) ? taskFns.length : 0;
  if (!total) return;
  const max = Math.max(1, Number(limit) || 1);
  let cursor = 0;
  const worker = async () => {
    while (cursor < total) {
      const idx = cursor++;
      await taskFns[idx]();
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(max, total); i++) workers.push(worker());
  await Promise.all(workers);
};
App.isRtdbPayloadTooLargeError = function (err) {
  const msg = String(err?.message || err || "");
  return /payload is too large|request a location with less data|less data/i.test(msg);
};
App.updateRefPayloadChildrenWithRetry = async function (ref, payload, attempts = App.RTDB_CHUNK_UPLOAD_RETRIES, signal = null) {
  const entries = Object.entries(payload || {});
  for (const [key, value] of entries) {
    App.throwIfUploadAborted(signal);
    await App.setRefWithRetry(ref.child(key), value, attempts, signal);
  }
};
App.updateRefWithRetry = async function (ref, payload, attempts = App.RTDB_CHUNK_UPLOAD_RETRIES, signal = null) {
  let lastErr = null;
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  const canSplitPayload = payload && typeof payload === "object" && !Array.isArray(payload);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    App.throwIfUploadAborted(signal);
    try {
      await ref.update(payload);
      App.throwIfUploadAborted(signal);
      return;
    } catch (e) {
      if (App.isUploadAbortError(e)) throw e;
      if (canSplitPayload && App.isRtdbPayloadTooLargeError(e)) {
        await App.updateRefPayloadChildrenWithRetry(ref, payload, maxAttempts, signal);
        return;
      }
      lastErr = e;
      if (attempt >= maxAttempts) break;
      await App.sleep(attempt * 250);
    }
  }
  throw lastErr || new Error("chunk upload failed");
};
App.setRefWithRetry = async function (ref, payload, attempts = App.RTDB_CHUNK_UPLOAD_RETRIES, signal = null) {
  let lastErr = null;
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    App.throwIfUploadAborted(signal);
    try {
      await ref.set(payload);
      App.throwIfUploadAborted(signal);
      return;
    } catch (e) {
      if (App.isUploadAbortError(e)) throw e;
      lastErr = e;
      if (attempt >= maxAttempts) break;
      await App.sleep(attempt * 250);
    }
  }
  throw lastErr || new Error("set failed");
};
App.writeChunkedFieldToRef = async function (ref, fieldName, value, options = {}) {
  const entries = App.splitChunkedFieldEntries(fieldName, value);
  const signal = options.signal || null;
  const progressField = options.progressField || "";
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const batchSize = Math.max(1, Number(options.batchSize || App.RTDB_STRING_UPLOAD_BATCH_SIZE) || App.RTDB_STRING_UPLOAD_BATCH_SIZE);
  const total = Math.max(1, entries.length);
  let written = 0;
  for (let i = 0; i < entries.length; i += batchSize) {
    App.throwIfUploadAborted(signal);
    const batchEntries = entries.slice(i, i + batchSize);
    const batch = Object.fromEntries(batchEntries);
    written = Math.min(total, i + batchEntries.length);
    const pct = App.calcUploadPercent(written, total);
    if (progressField) batch[progressField] = pct;
    await App.updateRefWithRetry(ref, batch, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
    if (onProgress) onProgress(pct);
  }
  return entries.length;
};
App.writeBlobDataURLToRef = async function (ref, fieldName, blob, options = {}) {
  if (!(blob instanceof Blob)) return await App.writeChunkedFieldToRef(ref, fieldName, "", options);
  const signal = options.signal || null;
  const progressField = options.progressField || "";
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const batchSize = Math.max(1, Number(options.batchSize || App.RTDB_STRING_UPLOAD_BATCH_SIZE) || App.RTDB_STRING_UPLOAD_BATCH_SIZE);
  const totalChars = Math.max(1, App.dataURLCharLengthForBlob(blob));
  const totalBytes = Math.max(0, Number(blob.size || 0));
  let committedChars = 0;
  let pending = App.dataURLPrefixForBlob(blob);
  let chunkIndex = 1;
  let payload = {};
  let payloadCount = 0;
  let lastProgress = 0;
  const flushPayload = async pct => {
    if (!payloadCount) return;
    const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
    if (progressField) payload[progressField] = safePct;
    await App.updateRefWithRetry(ref, payload, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
    lastProgress = safePct;
    if (onProgress) onProgress(safePct);
    payload = {};
    payloadCount = 0;
  };
  const queuePart = async part => {
    const key = chunkIndex === 1 ? fieldName : `${fieldName}${chunkIndex}`;
    chunkIndex += 1;
    committedChars += part.length;
    payload[key] = part;
    payloadCount += 1;
    const pct = App.calcUploadPercent(committedChars, totalChars);
    if (payloadCount >= batchSize) await flushPayload(pct);
  };
  const flushAvailable = async (force = false) => {
    while (pending.length >= App.RTDB_DATA_CHUNK_SIZE || force && pending.length) {
      App.throwIfUploadAborted(signal);
      const part = force && pending.length <= App.RTDB_DATA_CHUNK_SIZE ? pending : pending.slice(0, App.RTDB_DATA_CHUNK_SIZE);
      pending = pending.slice(part.length);
      await queuePart(part);
    }
  };
  await flushAvailable(false);
  if (!totalBytes) {
    await flushAvailable(true);
    if (payloadCount) await flushPayload(100);else if (progressField && lastProgress < 100) await App.updateRefWithRetry(ref, {
      [progressField]: 100
    }, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
    if (onProgress && lastProgress < 100) onProgress(100);
    return chunkIndex - 1;
  }
  for (let start = 0; start < totalBytes; start += App.RTDB_BLOB_READ_BYTES) {
    const end = Math.min(totalBytes, start + App.RTDB_BLOB_READ_BYTES);
    pending += await App.readBlobSliceAsBase64(blob, start, end, signal);
    await flushAvailable(false);
  }
  await flushAvailable(true);
  if (payloadCount) await flushPayload(100);else if (progressField && lastProgress < 100) await App.updateRefWithRetry(ref, {
    [progressField]: 100
  }, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
  if (onProgress && lastProgress < 100) onProgress(100);
  return chunkIndex - 1;
};
App.writeTextFileChunksToRef = async function (ref, fieldName, file, options = {}) {
  if (!(file instanceof Blob)) return await App.writeHtmlStringChunksToRef(ref, fieldName, "", options);
  const signal = options.signal || null;
  const progressField = options.progressField || "";
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const batchSize = Math.max(1, Number(options.batchSize || App.RTDB_STRING_UPLOAD_BATCH_SIZE) || App.RTDB_STRING_UPLOAD_BATCH_SIZE);
  const totalBytes = Math.max(0, Number(file.size || 0));
  const decoder = new TextDecoder("utf-8", {
    fatal: false
  });
  const chunkLimit = Math.max(50000, Number(options.chunkSize || App.HTML_HUB_CHUNK_SIZE) || App.HTML_HUB_CHUNK_SIZE);
  let pending = "";
  let part = 1;
  let loadedBytes = 0;
  let payload = {};
  let payloadCount = 0;
  const flushPayload = async pct => {
    if (!payloadCount) return;
    if (progressField) payload[progressField] = pct;
    await App.updateRefWithRetry(ref, payload, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
    if (onProgress) onProgress(pct);
    payload = {};
    payloadCount = 0;
  };
  const queueTextPart = async text => {
    const key = part === 1 ? fieldName : `${fieldName}${part}`;
    part += 1;
    const pct = totalBytes ? App.calcUploadPercent(loadedBytes, totalBytes) : 100;
    payload[key] = text;
    payloadCount += 1;
    if (payloadCount >= batchSize) await flushPayload(pct);
  };
  const flushText = async (force = false) => {
    while (pending.length >= chunkLimit || force && pending.length) {
      App.throwIfUploadAborted(signal);
      const text = force && pending.length <= chunkLimit ? pending : pending.slice(0, chunkLimit);
      pending = pending.slice(text.length);
      await queueTextPart(text);
    }
  };
  if (!totalBytes) {
    await App.updateRefWithRetry(ref, {
      [fieldName]: "",
      [`${fieldName}ChunkCount`]: 1,
      ...(progressField ? {
        [progressField]: 100
      } : {})
    }, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
    if (onProgress) onProgress(100);
    return 1;
  }
  for (let start = 0; start < totalBytes; start += App.RTDB_BLOB_READ_BYTES) {
    const end = Math.min(totalBytes, start + App.RTDB_BLOB_READ_BYTES);
    App.throwIfUploadAborted(signal);
    const buffer = await file.slice(start, end).arrayBuffer();
    App.throwIfUploadAborted(signal);
    loadedBytes = end;
    pending += decoder.decode(buffer, {
      stream: end < totalBytes
    });
    await flushText(false);
  }
  pending += decoder.decode();
  loadedBytes = totalBytes;
  await flushText(true);
  const count = Math.max(1, part - 1);
  payload[`${fieldName}ChunkCount`] = count;
  payloadCount += 1;
  if (progressField) payload[progressField] = 100;
  await App.updateRefWithRetry(ref, payload, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
  if (onProgress) onProgress(100);
  return count;
};
App.writeHtmlStringChunksToRef = async function (ref, fieldName, html, options = {}) {
  const signal = options.signal || null;
  const s = String(html || "");
  const batchSize = Math.max(1, Number(options.batchSize || App.RTDB_STRING_UPLOAD_BATCH_SIZE) || App.RTDB_STRING_UPLOAD_BATCH_SIZE);
  const total = Math.max(1, Math.ceil(s.length / App.HTML_HUB_CHUNK_SIZE));
  let part = 1;
  let payload = {};
  let payloadCount = 0;
  const flushPayload = async pct => {
    if (!payloadCount) return;
    if (options.progressField) payload[options.progressField] = pct;
    await App.updateRefWithRetry(ref, payload, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
    if (typeof options.onProgress === "function") options.onProgress(pct);
    payload = {};
    payloadCount = 0;
  };
  for (let i = 0; i < s.length || i === 0 && !s; i += App.HTML_HUB_CHUNK_SIZE) {
    App.throwIfUploadAborted(signal);
    const key = part === 1 ? fieldName : `${fieldName}${part}`;
    const pct = App.calcUploadPercent(part, total);
    payload[key] = s.slice(i, i + App.HTML_HUB_CHUNK_SIZE);
    payloadCount += 1;
    if (payloadCount >= batchSize) await flushPayload(pct);
    part += 1;
  }
  const count = Math.max(1, part - 1);
  payload[`${fieldName}ChunkCount`] = count;
  payloadCount += 1;
  if (options.progressField) payload[options.progressField] = 100;
  await App.updateRefWithRetry(ref, payload, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
  if (typeof options.onProgress === "function") options.onProgress(100);
  return count;
};
App.createFirebaseUploadScope = function ({
  type,
  place,
  cleanup,
  disconnectRefs = []
} = {}) {
  const controller = new AbortController();
  const id = `upload_${Date.now().toString(36)}_${(++App.activeFirebaseUploadSeq).toString(36)}`;
  const scope = {
    id,
    type: String(type || "upload"),
    place: String(place || ""),
    controller,
    signal: controller.signal,
    cleanup: typeof cleanup === "function" ? cleanup : async () => {},
    disconnectRefs: Array.isArray(disconnectRefs) ? disconnectRefs.filter(Boolean) : [],
    done: false,
    cleaning: false
  };
  scope.abort = (reason = "upload aborted") => {
    if (!scope.signal.aborted) {
      try {
        scope.controller.abort(reason);
      } catch {}
    }
    void App.cleanupFirebaseUploadScope(scope, reason);
  };
  App.activeFirebaseUploads.set(scope.id, scope);
  return scope;
};
App.armFirebaseUploadDisconnect = async function (scope) {
  if (!scope || !Array.isArray(scope.disconnectRefs)) return;
  for (const ref of scope.disconnectRefs) {
    try {
      await ref.onDisconnect().remove();
    } catch {}
  }
};
App.finishFirebaseUploadScope = async function (scope) {
  if (!scope) return;
  scope.done = true;
  App.activeFirebaseUploads.delete(scope.id);
  if (Array.isArray(scope.disconnectRefs)) {
    for (const ref of scope.disconnectRefs) {
      try {
        await ref.onDisconnect().cancel();
      } catch {}
    }
  }
};
App.cleanupFirebaseUploadScope = async function (scope, reason = "upload aborted") {
  if (!scope || scope.cleaning || scope.done) return;
  scope.cleaning = true;
  App.activeFirebaseUploads.delete(scope.id);
  try {
    if (!scope.signal.aborted) {
      try {
        scope.controller.abort(reason);
      } catch {}
    }
  } catch {}
  try {
    await scope.cleanup(reason);
  } catch {}
};
App.abortFirebaseUploadsForPlaceChange = function (nextPlace) {
  const next = String(nextPlace || "");
  for (const scope of Array.from(App.activeFirebaseUploads.values())) {
    if (!scope.place || scope.place === next) continue;
    scope.abort("page changed");
  }
};
App.abortAllFirebaseUploads = function (reason = "page unload") {
  for (const scope of Array.from(App.activeFirebaseUploads.values())) {
    try {
      if (!scope.signal.aborted) scope.controller.abort(reason);
    } catch {}
  }
};
App.writeMessageAttachmentsToRef = async function (messageRef, files = [], options = {}) {
  if (files.length > App.CHAT_FILE_MAX_COUNT) throw new Error(`Maximum ${App.CHAT_FILE_MAX_COUNT} attachments per message`);
  const signal = options.signal || null;
  const taskFns = [];
  const onItemProgress = (group, index, pct) => {
    if (typeof options.onProgress === "function") {
      options.onProgress({
        group,
        index,
        progress: pct
      });
    }
  };
  const writeAttachment = async (childRef, item, group, index) => {
    App.throwIfUploadAborted(signal);
    const existing = App.readChunkedField(item, "dataURL") || String(item?.dataURL || "");
    const blob = item?.fileObject instanceof Blob ? item.fileObject : null;
    const count = blob ? App.countDataURLChunksForBlob(blob) : App.countChunkedPartsForValue(existing);
    await App.updateRefWithRetry(childRef, {
      uploadPending: 1,
      uploadProgress: 0,
      dataChunkCount: count
    }, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
    if (blob) {
      await App.writeBlobDataURLToRef(childRef, "dataURL", blob, {
        signal,
        progressField: "uploadProgress",
        onProgress: pct => onItemProgress(group, index, pct)
      });
    } else {
      await App.writeChunkedFieldToRef(childRef, "dataURL", existing, {
        signal,
        progressField: "uploadProgress",
        onProgress: pct => onItemProgress(group, index, pct)
      });
    }
    await App.updateRefWithRetry(childRef, {
      uploadPending: null,
      uploadProgress: 100
    }, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
    delete item.previewURL;
    delete item.__loading;
    delete item.uploadPending;
    item.uploadProgress = 100;
    item.dataChunkCount = count;
  };
  for (let i = 0; i < files.length; i++) {
    taskFns.push(() => writeAttachment(messageRef.child(`files/${i}`), files[i], "files", i));
  }
  await App.runTaskPool(taskFns, App.RTDB_CHUNK_UPLOAD_CONCURRENCY);
  await App.updateRefWithRetry(messageRef, {
    attachmentsSyncedAt: App.firebase.database.ServerValue.TIMESTAMP
  }, App.RTDB_CHUNK_UPLOAD_RETRIES, signal);
};
App.normalizeMessageMedia = function (msg) {
  if (!msg || typeof msg !== "object") return msg;
  const out = App.stripChunkedField(msg, "dataURL");
  const rootDataURL = App.readChunkedField(msg, "dataURL");
  if (rootDataURL) out.dataURL = rootDataURL;
  if (Array.isArray(out.files)) out.files = out.files.map(App.normalizeChunkedAttachment);
  return out;
};
App.mergeChunkedAttachmentForDisplay = function (nextFile, prevFile) {
  const next = App.normalizeChunkedAttachment(nextFile);
  const prev = App.normalizeChunkedAttachment(prevFile);
  if (!next || typeof next !== "object") return next;
  const mergedDataURL = String(next.dataURL || prev?.dataURL || "");
  const mergedPreviewURL = String(next.previewURL || prev?.previewURL || "");
  const mergedProgress = Math.max(Number(next.uploadProgress || 0), Number(prev?.uploadProgress || 0));
  if (!mergedDataURL) {
    const pending = mergedPreviewURL ? {
      ...next,
      previewURL: mergedPreviewURL
    } : {
      ...next
    };
    if (mergedProgress > 0) pending.uploadProgress = mergedProgress;
    return pending;
  }
  const merged = {
    ...next,
    dataURL: mergedDataURL
  };
  delete merged.previewURL;
  delete merged.__loading;
  delete merged.uploadPending;
  delete merged.dataChunkCount;
  return merged;
};
App.mergeMessageMediaForDisplay = function (nextMsg, prevMsg) {
  const next = App.normalizeMessageMedia(nextMsg);
  if (!next || typeof next !== "object") return next;
  const prev = App.normalizeMessageMedia(prevMsg);
  if (prev && typeof prev === "object") {
    if (!Number.isFinite(Number(next.createdAt)) && Number.isFinite(Number(prev.createdAt))) {
      next.createdAt = Number(prev.createdAt);
    }
    const nextSyncedAt = Number(next.attachmentsSyncedAt || 0);
    const prevSyncedAt = Number(prev.attachmentsSyncedAt || 0);
    if (prevSyncedAt > nextSyncedAt) next.attachmentsSyncedAt = prevSyncedAt;
    if (!next.dataURL && prev.dataURL) next.dataURL = prev.dataURL;
    if (Array.isArray(next.files) && Array.isArray(prev.files)) {
      next.files = next.files.map((file, i) => App.mergeChunkedAttachmentForDisplay(file, prev.files[i]));
    }
  }
  delete next.__stub;
  return next;
};
App.cancelMessageMediaRefresh = function (roomId, msgKey) {
  const rid = String(roomId || "");
  const key = String(msgKey || "");
  if (!rid || !key) return;
  const timerKey = `${rid}:${key}`;
  const rec = App.pendingMessageMediaRefreshTimers.get(timerKey);
  if (rec) {
    try {
      clearTimeout(rec.timer || rec);
    } catch {}
  }
  App.pendingMessageMediaRefreshTimers.delete(timerKey);
};
App.cancelMessageMediaRefreshesForRoom = function (roomId = null) {
  const rid = roomId == null ? "" : String(roomId || "");
  for (const [timerKey, rec] of Array.from(App.pendingMessageMediaRefreshTimers.entries())) {
    if (rid && String(rec?.roomId || "") !== rid) continue;
    try {
      clearTimeout(rec?.timer || rec);
    } catch {}
    App.pendingMessageMediaRefreshTimers.delete(timerKey);
  }
};
App.scheduleMessageMediaRefresh = function (roomId, msgKey, delay = 120) {
  const rid = String(roomId || "");
  const key = String(msgKey || "");
  if (!rid || !key) return;
  const isCurrentRoom = () => String(App.currentRoomId || "") === rid && String(App.msgHistoryRoomId || "") === rid;
  if (!isCurrentRoom()) return;
  const timerKey = `${rid}:${key}`;
  const prevRec = App.pendingMessageMediaRefreshTimers.get(timerKey);
  if (prevRec) {
    try {
      clearTimeout(prevRec.timer || prevRec);
    } catch {}
  }
  const waitMs = Math.max(0, Number(delay) || 0);
  const nextWaitMs = Math.min(1500, Math.max(180, Math.round(waitMs * 1.8) || 180));
  const timer = setTimeout(() => {
    const activeRec = App.pendingMessageMediaRefreshTimers.get(timerKey);
    if (activeRec?.timer === timer) App.pendingMessageMediaRefreshTimers.delete(timerKey);
    if (!isCurrentRoom() || !App.renderedMsgKeys.has(key)) return;
    App.db.ref(`messages/${rid}/${key}`).once("value").then(freshSnap => {
      if (!isCurrentRoom() || !App.renderedMsgKeys.has(key)) return;
      const freshRaw = freshSnap.val();
      if (!freshRaw) return;
      const prev = App.msgDataByKey.get(key) || null;
      const freshMsg = App.mergeMessageMediaForDisplay(App.normalizeMessageMedia({
        ...freshRaw,
        _key: key
      }), prev);
      App.replaceMessageRowByKey(freshMsg);
      App.refreshReplyPreviewDependents(key);
      if (App.messageHasPendingChunkedMedia(freshMsg)) {
        App.scheduleMessageMediaRefresh(rid, key, nextWaitMs);
      }
    }).catch(() => {
      if (!isCurrentRoom() || !App.renderedMsgKeys.has(key)) return;
      const current = App.msgDataByKey.get(key);
      if (App.messageHasPendingChunkedMedia(current)) App.scheduleMessageMediaRefresh(rid, key, nextWaitMs);
    });
  }, waitMs);
  App.pendingMessageMediaRefreshTimers.set(timerKey, {
    timer,
    roomId: rid,
    msgKey: key
  });
};
App.getChatAttachmentByteSize = function (fileOrAttachment) {
  const sourceSize = Number(fileOrAttachment?.fileObject?.size);
  if (Number.isFinite(sourceSize) && sourceSize >= 0) return sourceSize;
  const directSize = Number(fileOrAttachment?.size);
  return Number.isFinite(directSize) && directSize >= 0 ? directSize : 0;
};
App.isChatAttachmentOverSizeLimit = function (fileOrAttachment) {
  return App.getChatAttachmentByteSize(fileOrAttachment) > App.CHAT_FILE_MAX_BYTES;
};
App.showChatFileTooLargeToast = function (fileOrAttachment) {
  const name = String(fileOrAttachment?.fileName || fileOrAttachment?.name || "That file");
  App.showToast({
    title: "File too large",
    body: `${name} is over the ${App.CHAT_FILE_MAX_LABEL} limit for chat rooms.`,
    duration: 3600
  });
};
App.addPendingFile = async function (file, options = {}) {
  if (!file) return false;
  if (App.pendingFiles.length >= App.CHAT_FILE_MAX_COUNT) {
    App.showChatFileLimitToast();
    return false;
  }
  if (App.isChatAttachmentOverSizeLimit(file)) {
    App.showChatFileTooLargeToast(file);
    return false;
  }
  const kind = App.chatFileKind(file);
  let previewURL = "";
  try {
    previewURL = URL.createObjectURL(file);
  } catch {
    previewURL = "";
  }
  const isVoiceMessage = !!options.isVoiceMessage;
  App.pendingFiles.push({
    id: Math.random().toString(36).slice(2),
    kind,
    name: file.name || "file",
    fileName: file.name || "file",
    displayName: isVoiceMessage ? String(options.displayName || "Voice Message") : "",
    isVoiceMessage,
    voiceTrimStartSec: Math.max(0, Number(options.voiceTrimStartSec) || 0),
    type: file.type || "",
    mimeType: file.type || App.getMediaMimeType(file) || "",
    size: Number(file.size || 0),
    previewURL,
    fileObject: file
  });
  App.renderFilesBar();
  App.syncChatOverlayMetrics();
  return true;
};
App.showChatFileLimitToast = function () {
  App.showToast({ title: "Max files", body: `You can attach up to ${App.CHAT_FILE_MAX_COUNT} files per message.`, duration: 2600 });
};
App.canAcceptChatFiles = function () {
  const input = App.$("msg-input");
  const modalBlocksChat = App.$("modal")?.hidden === false && !(App.isTimeDisplayExpanded?.() && App.timeChatOpen);
  return !!(App.currentUser && App.currentRoomId && App.getStoredPlace() === `room:${App.currentRoomId}` &&
    App.views.chat?.dataset.active === "true" && input && !input.disabled && !App.editState && !modalBlocksChat);
};
App.addChatFiles = async function (files) {
  if (!App.canAcceptChatFiles()) return 0;
  App.initOverlaysUI();
  const room = App.currentRoomId, code = App.currentUser.code;
  let added = 0;
  for (const file of Array.from(files || [])) {
    if (App.currentRoomId !== room || App.currentUser?.code !== code) break;
    if (App.pendingFiles.length >= App.CHAT_FILE_MAX_COUNT) { App.showChatFileLimitToast(); break; }
    if (await App.addPendingFile(file)) added++;
  }
  return added;
};
App.filesFromTransfer = function (transfer) {
  if (transfer?.files?.length) return Array.from(transfer.files);
  return Array.from(transfer?.items || []).filter(item => item.kind === "file").map(item => item.getAsFile()).filter(Boolean);
};
App.bindChatFileTransfers = function () {
  const chat = App.$("view-chat");
  if (!chat) return;
  let depth = 0;
  const hasFiles = transfer => Array.from(transfer?.types || []).includes("Files") || Array.from(transfer?.items || []).some(item => item.kind === "file");
  const clear = () => { depth = 0; chat.classList.remove("chat-file-dragover"); };
  chat.addEventListener("dragenter", event => {
    if (!hasFiles(event.dataTransfer) || !App.canAcceptChatFiles()) return;
    event.preventDefault(); depth++; chat.classList.add("chat-file-dragover");
  });
  chat.addEventListener("dragover", event => {
    if (!hasFiles(event.dataTransfer) || !App.canAcceptChatFiles()) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "copy";
  });
  chat.addEventListener("dragleave", event => { if (--depth <= 0 || !chat.contains(event.relatedTarget)) clear(); });
  chat.addEventListener("drop", event => {
    clear();
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (App.canAcceptChatFiles()) void App.addChatFiles(App.filesFromTransfer(event.dataTransfer));
  });
  document.addEventListener("dragend", clear);
  window.addEventListener("blur", clear);
  document.addEventListener("paste", async event => {
    if (event.defaultPrevented || !App.canAcceptChatFiles()) return;
    const target = event.target;
    if (target?.closest?.("input,textarea,[contenteditable='true']") && target !== App.$("msg-input")) return;
    const files = App.filesFromTransfer(event.clipboardData);
    if (!files.length) {
      // Windows Explorer puts file paths on its native file-drop clipboard.
      // Read those only during this explicit paste, never in the background.
      if (event.clipboardData?.getData("text/plain") || !window.chatDesktopClipboard?.readFiles) return;
      const room = App.currentRoomId, code = App.currentUser.code;
      try {
        const nativeFiles = await window.chatDesktopClipboard.readFiles(Math.max(0, App.CHAT_FILE_MAX_COUNT - App.pendingFiles.length));
        if (!App.canAcceptChatFiles() || room !== App.currentRoomId || code !== App.currentUser?.code) return;
        await App.addChatFiles(nativeFiles.map(item => new File([item.data], item.name, { type: item.type || "application/octet-stream" })));
      } catch (error) {
        App.showToast({ title: "Paste failed", body: String(error?.message || "Could not read files from the clipboard."), duration: 3200 });
      }
      return;
    }
    event.preventDefault();
    void App.addChatFiles(files);
  });
};

App.register("media/uploads", function initializeFeature() {
App.RTDB_DATA_CHUNK_SIZE = 300000;
App.RTDB_BLOB_READ_BYTES = 786432;
App.RTDB_STRING_UPLOAD_BATCH_SIZE = 3;
App.RTDB_CHUNK_UPLOAD_CONCURRENCY = 4;
App.RTDB_CHUNK_UPLOAD_RETRIES = 4;
App.activeFirebaseUploads = new Map();
App.activeFirebaseUploadSeq = 0;
window.addEventListener("pagehide", () => App.abortAllFirebaseUploads("page hidden"), {
  capture: true
});
window.addEventListener("beforeunload", () => App.abortAllFirebaseUploads("page unload"), {
  capture: true
});
App.pendingMessageMediaRefreshTimers = new Map();
App.CHAT_FILE_MAX_BYTES = 125 * 1024 * 1024;
App.CHAT_FILE_MAX_LABEL = "125 MB";
App.CHAT_FILE_MAX_COUNT = 12;
App.bindChatFileTransfers();
});
})(globalThis.ChatApp);
