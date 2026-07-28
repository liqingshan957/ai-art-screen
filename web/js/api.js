/**
 * api.js — 统一 API 客户端
 *
 * 用法:
 *   await api.artworks.list()
 *   await api.cms.albums.list()
 *   await api.cms.media.addUrl(albumId, { mediaUrl, mediaName })
 *
 * 架构:
 *   api.artworks   — 作品管理（混合本地 + CMS）
 *   api.cms        — CMS 对接（配置 / 相册 / 媒体 / 抠图）
 *   api.background — 背景图
 *   api.videos     — 视频插播
 *   api.analytics  — 统计
 */
(function () {
  'use strict';

  const BASE = '';

  async function request(method, path, opts) {
    const url = BASE + path;
    const options = { method, headers: {} };
    if (opts && opts.body !== undefined) {
      if (opts.body instanceof FormData) {
        options.body = opts.body; // let browser set Content-Type
      } else {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(opts.body);
      }
    }
    const res = await fetch(url, options);
    const data = await res.json();
    if (data.code !== undefined && data.code !== 0) {
      throw new Error(data.message || 'API error (code=' + data.code + ')');
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  function get(path) { return request('GET', path); }
  function post(path, body) { return request('POST', path, { body }); }
  function put(path, body) { return request('PUT', path, { body }); }
  function del(path) { return request('DELETE', path); }

  // ================================================
  // 作品管理（本地 + CMS 合并）
  // ================================================
  const artworks = {
    list(all) { return get('/api/artworks' + (all ? '/all' : '')); },
    stats() { return get('/api/artworks/stats'); },
    upload(formData, onProgress) {
      return fetch(BASE + '/api/artworks/upload', { method: 'POST', body: formData })
        .then(r => r.json());
    },
    batch(formData) {
      return fetch(BASE + '/api/artworks/batch', { method: 'POST', body: formData })
        .then(r => r.json());
    },
    archive(id) { return put('/api/artworks/' + id + '/archive'); },
    restore(id) { return put('/api/artworks/' + id + '/restore'); },
    purge(id) { return del('/api/artworks/' + id + '/purge'); },
    regenerate() { return post('/api/regenerate-pages'); },
  };

  // ================================================
  // CMS 对接
  // ================================================
  const cms = {
    // --- 配置 ---
    config: {
      get() { return get('/api/cms/config'); },
      save(apiKey, apiBase) { return post('/api/cms/config', { apiKey, apiBase }); },
    },
    test() { return get('/api/cms/test'); },
    sync() { return post('/api/cms/sync'); },

    // --- 相册 ---
    albums: {
      list(params) {
        const q = params ? '?' + new URLSearchParams(params).toString() : '';
        return get('/api/cms/albums' + q);
      },
      get(id) { return get('/api/cms/albums/' + id); },
      create(data) { return post('/api/cms/albums', data); },
      update(id, data) { return put('/api/cms/albums/' + id, data); },
      enable(id, enabled) { return put('/api/cms/albums/' + id + '/enable', { enabled }); },
    },

    // --- 媒体 ---
    media: {
      list(albumId, params) {
        const q = params ? '?' + new URLSearchParams(params).toString() : '';
        return get('/api/cms/albums/' + albumId + '/media' + q);
      },
      add(albumId, formData) {
        return fetch(BASE + '/api/cms/albums/' + albumId + '/media', { method: 'POST', body: formData })
          .then(r => r.json());
      },
      /** 添加已上传的 URL 到相册（避免重复上传文件） */
      addUrl(albumId, data) { return post('/api/cms/albums/' + albumId + '/media/add-url', data); },
      /** 从本地服务器上传文件到 CMS 并添加到相册 */
      async uploadAndAdd(albumId, file, name) {
        const fd = new FormData();
        fd.append('file', file);
        // Step 1: upload to CMS
        const up = await fetch(BASE + '/api/cms/upload', { method: 'POST', body: fd }).then(r => r.json());
        if (!up.success) throw new Error(up.error || '文件上传失败');
        // Step 2: add URL to album
        return cms.media.addUrl(albumId, { mediaUrl: up.url, sourceUrl: up.url, mediaName: name || file.name.replace(/\.[^.]+$/, '') });
      },
      enable(albumId, mediaId, enabled) { return put('/api/cms/albums/' + albumId + '/media/' + mediaId + '/enable', { enabled }); },
      remove(albumId, mediaId) { return del('/api/cms/albums/' + albumId + '/media/' + mediaId); },
      update(albumId, mediaId, data) { return put('/api/cms/albums/' + albumId + '/media/' + mediaId, data); },
      view(mediaId) { return post('/api/cms/albums/media/' + mediaId + '/view'); },
      like(mediaId) { return post('/api/cms/albums/media/' + mediaId + '/like'); },
    },

    // --- 抠图 ---
    cutout: {
      trigger(albumId, mediaId) { return post('/api/cms/cutout/' + albumId + '/' + mediaId); },
      scan(albumId) { return post('/api/cms/cutout/scan/' + albumId); },
      status() { return get('/api/cms/cutout/queue'); },
      clearDone() { return del('/api/cms/cutout/queue'); },
    },

    // --- 文件上传（通用） ---
    upload(formData) {
      return fetch(BASE + '/api/cms/upload', { method: 'POST', body: formData }).then(r => r.json());
    },
  };

  // ================================================
  // 背景图
  // ================================================
  const background = {
    get() { return get('/api/background'); },
    upload(formData) {
      return fetch(BASE + '/api/background/upload', { method: 'POST', body: formData }).then(r => r.json());
    },
    update(data) { return put('/api/background', data); },
  };

  // ================================================
  // 视频
  // ================================================
  const videos = {
    list() { return get('/api/videos'); },
    config() { return get('/api/videos/config'); },
    upload(formData) {
      return fetch(BASE + '/api/videos/upload', { method: 'POST', body: formData }).then(r => r.json());
    },
    remove(id) { return del('/api/videos/' + id); },
    updateConfig(data) { return put('/api/videos/config', data); },
  };

  // ================================================
  // 统计
  // ================================================
  const analytics = {
    today() { return get('/api/analytics/today'); },
  };

  const dashboard = {
    today() { return get('/api/dashboard/today'); },
    save(data) { return post('/api/dashboard/today', data); },
  };

  // ================================================
  // 暴露全局
  // ================================================
  window.api = { artworks, cms, background, videos, analytics, dashboard, _request: request, _get: get, _post: post, _put: put, _del: del };
})();
