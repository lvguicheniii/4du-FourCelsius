function positiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function cleanHash(value, length) {
  const hash = String(value || '').trim().toLowerCase();
  return !hash || new RegExp(`^[a-f0-9]{${length}}$`).test(hash) ? hash : null;
}

const MAX_APK_FILE_SIZE = 1024 * 1024 * 1024;

function validateApkRelease({ apkUrl, fileSize, md5, sha256 }) {
  let parsedUrl;
  try {
    parsedUrl = new URL(apkUrl);
  } catch {
    return 'APK URL 格式不正确';
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    return 'APK URL 必须使用不含账号信息的 HTTPS 地址';
  }
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_APK_FILE_SIZE) {
    return 'APK 文件大小必须在 1 字节到 1 GB 之间';
  }
  if (!/^[a-f0-9]{32}$/.test(md5) || !/^[a-f0-9]{64}$/.test(sha256)) {
    return '发布 APK 前必须填写有效的 MD5 和 SHA-256';
  }
  return '';
}

module.exports = function registerAppReleaseAdmin(router, {
  adminAuth,
  requireSuperAdmin,
  db,
  uuid,
  logAdmin,
}) {
  router.get('/update-logs', adminAuth, (req, res) => {
    const logs = db.prepare(`
      SELECT id,stage,platform,version_name,update_id,runtime_version,title,release_notes,
             release_date,is_visible,created_at,updated_at
      FROM app_update_logs
      ORDER BY release_date DESC, created_at DESC
      LIMIT 500
    `).all();
    res.json({ logs });
  });

  router.post('/update-logs', adminAuth, requireSuperAdmin, (req, res) => {
    const versionName = String(req.body?.versionName || '').trim();
    const updateId = String(req.body?.updateId || '').trim().toLowerCase();
    const runtimeVersion = String(req.body?.runtimeVersion || '').trim();
    const title = String(req.body?.title || '').trim();
    const releaseNotes = String(req.body?.releaseNotes || '').trim();
    const releaseDate = String(req.body?.releaseDate || '').trim();
    const platform = ['android', 'ios', 'all'].includes(req.body?.platform) ? req.body.platform : 'android';
    const stage = req.body?.stage === 'production' ? 'production' : 'development';
    if (!versionName || versionName.length > 60) return res.status(400).json({ error: '版本号不能为空且不能超过 60 个字符' });
    if (!title || title.length > 120) return res.status(400).json({ error: '更新标题不能为空且不能超过 120 个字符' });
    if (!releaseNotes || releaseNotes.length > 5000) return res.status(400).json({ error: '更新内容不能为空且不能超过 5000 个字符' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return res.status(400).json({ error: '发布日期格式不正确' });
    if (updateId && !/^[a-f0-9-]{36}$/.test(updateId)) return res.status(400).json({ error: 'Expo Update ID 格式不正确' });
    const id = uuid();
    try {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(id, stage, platform, versionName, updateId || null, runtimeVersion, title, releaseNotes, releaseDate, req.body?.isVisible === false ? 0 : 1, req.adminId);
    } catch (error) {
      if (/UNIQUE constraint/i.test(String(error?.message || ''))) return res.status(409).json({ error: '版本号或 Update ID 已存在' });
      throw error;
    }
    logAdmin(req.adminId, 'create_update_log', 'app_update_log', id, `${versionName} · ${title}`, req.ip);
    res.status(201).json({ ok: true, id });
  });

  router.put('/update-logs/:id', adminAuth, requireSuperAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM app_update_logs WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '更新日志不存在' });
    const updateId = String(req.body?.updateId ?? row.update_id ?? '').trim().toLowerCase();
    const versionName = String(req.body?.versionName ?? row.version_name).trim();
    const title = String(req.body?.title ?? row.title).trim();
    const releaseNotes = String(req.body?.releaseNotes ?? row.release_notes).trim();
    const releaseDate = String(req.body?.releaseDate ?? row.release_date).trim();
    if (!versionName || versionName.length > 60 || !title || title.length > 120 || !releaseNotes || releaseNotes.length > 5000) return res.status(400).json({ error: '更新日志字段不完整或长度超限' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return res.status(400).json({ error: '发布日期格式不正确' });
    if (updateId && !/^[a-f0-9-]{36}$/.test(updateId)) return res.status(400).json({ error: 'Expo Update ID 格式不正确' });
    try {
      db.prepare(`UPDATE app_update_logs SET version_name=?,update_id=?,runtime_version=?,title=?,release_notes=?,
        release_date=?,stage=?,platform=?,is_visible=?,updated_at=datetime('now','+8 hours') WHERE id=?`).run(
        versionName, updateId || null, String(req.body?.runtimeVersion ?? row.runtime_version).trim(), title, releaseNotes,
        releaseDate, req.body?.stage === 'production' ? 'production' : 'development',
        ['android', 'ios', 'all'].includes(req.body?.platform) ? req.body.platform : row.platform,
        req.body?.isVisible === false ? 0 : 1, row.id,
      );
    } catch (error) {
      if (/UNIQUE constraint/i.test(String(error?.message || ''))) return res.status(409).json({ error: '版本号或 Update ID 已存在' });
      throw error;
    }
    logAdmin(req.adminId, 'update_update_log', 'app_update_log', row.id, `${versionName} · ${title}`, req.ip);
    res.json({ ok: true });
  });

  router.get('/app-releases', adminAuth, (req, res) => {
    const releases = db.prepare(`
      SELECT id,platform,version_code,version_name,runtime_version,apk_url,file_size,md5,sha256,
             release_notes,mandatory,is_active,created_at,published_at
      FROM app_releases
      ORDER BY version_code DESC
      LIMIT 100
    `).all();
    res.json({ releases });
  });

  router.post('/app-releases', adminAuth, requireSuperAdmin, (req, res) => {
    const versionCode = positiveInteger(req.body?.versionCode);
    const versionName = String(req.body?.versionName || '').trim();
    const runtimeVersion = String(req.body?.runtimeVersion || '').trim();
    const apkUrl = String(req.body?.apkUrl || '').trim();
    const releaseNotes = String(req.body?.releaseNotes || '').trim();
    const fileSize = Math.max(0, Number.parseInt(String(req.body?.fileSize || 0), 10) || 0);
    const md5 = cleanHash(req.body?.md5, 32);
    const sha256 = cleanHash(req.body?.sha256, 64);
    const mandatory = req.body?.mandatory ? 1 : 0;
    const publish = !!req.body?.publish;

    if (!versionCode) return res.status(400).json({ error: 'versionCode must be a positive integer' });
    if (!versionName || versionName.length > 40) return res.status(400).json({ error: 'Invalid versionName' });
    if (apkUrl.length > 2000) return res.status(400).json({ error: 'APK URL is too long' });
    if (releaseNotes.length > 5000) return res.status(400).json({ error: 'Release notes are too long' });
    if (md5 === null || sha256 === null) return res.status(400).json({ error: 'Invalid APK hash' });
    const releaseValidationError = validateApkRelease({ apkUrl, fileSize, md5, sha256 });
    if (releaseValidationError) return res.status(400).json({ error: releaseValidationError });

    const id = uuid();
    try {
      db.transaction(() => {
        if (publish) db.prepare("UPDATE app_releases SET is_active=0 WHERE platform='android'").run();
        db.prepare(`
          INSERT INTO app_releases (
            id,platform,version_code,version_name,runtime_version,apk_url,file_size,md5,sha256,
            release_notes,mandatory,is_active,created_by,published_at
          ) VALUES (?, 'android', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            CASE WHEN ?=1 THEN datetime('now','+8 hours') ELSE NULL END)
        `).run(
          id, versionCode, versionName, runtimeVersion, apkUrl, fileSize, md5 || '', sha256 || '',
          releaseNotes, mandatory, publish ? 1 : 0, req.adminId, publish ? 1 : 0,
        );
      })();
    } catch (error) {
      if (/UNIQUE constraint/i.test(String(error?.message || ''))) {
        return res.status(409).json({ error: 'This Android versionCode already exists' });
      }
      throw error;
    }

    logAdmin(req.adminId, 'create_app_release', 'app_release', id, `Android ${versionName} (${versionCode})`, req.ip);
    return res.status(201).json({ ok: true, id });
  });

  router.put('/app-releases/:id/publish', adminAuth, requireSuperAdmin, (req, res) => {
    const release = db.prepare("SELECT * FROM app_releases WHERE id=? AND platform='android'").get(req.params.id);
    if (!release) return res.status(404).json({ error: 'Release not found' });
    const releaseValidationError = validateApkRelease({
      apkUrl: release.apk_url,
      fileSize: release.file_size,
      md5: String(release.md5 || '').toLowerCase(),
      sha256: String(release.sha256 || '').toLowerCase(),
    });
    if (releaseValidationError) return res.status(400).json({ error: releaseValidationError });
    db.transaction(() => {
      db.prepare("UPDATE app_releases SET is_active=0 WHERE platform='android'").run();
      db.prepare("UPDATE app_releases SET is_active=1,published_at=datetime('now','+8 hours') WHERE id=?").run(release.id);
    })();
    logAdmin(req.adminId, 'publish_app_release', 'app_release', release.id, `Android ${release.version_name} (${release.version_code})`, req.ip);
    return res.json({ ok: true });
  });
};
