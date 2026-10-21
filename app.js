// Fuel Up - 核心逻辑 (v1.3 密码掩码与直观状态版)
const STORAGE_KEY = 'fuel_records_data_v1';
const SETTINGS_KEY = 'fuel_records_settings_v1';
const MASK_PLACEHOLDER = '••••••••••••••••'; // 掩码占位符

let currentOil = '92#';
let currentStation = '中国石化加油站';
let nearbyStations = [];
let currentPhotos = { dashboard: null, meter: null };
let currentPos = null;

window.addEventListener('DOMContentLoaded', () => {
  initDate();
  loadSettings();
  initLocation();
  renderStats();
  renderHistory();
  registerServiceWorker();
  initPullToRefresh();
});

// 1. 注册 PWA Service Worker
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// 2. 初始化日期
function initDate() {
  const now = new Date();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekDays[now.getDay()]}`;
  const dateEl = document.getElementById('currentDateStr');
  if (dateEl) dateEl.innerText = dateStr;
}

// 3. 高德地图周边加油站定位检索
function initLocation() {
  const locText = document.getElementById('locationText');
  const settings = getSettings();
  const amapKey = (settings.amapKey || '').trim();

  const fallbackTimer = setTimeout(() => {
    if (locText && locText.innerText.includes('正在')) {
      const records = getRecords();
      const lastStation = records.length > 0 ? records[0].station : '中国石化加油站';
      currentStation = lastStation;
      locText.innerText = `${currentStation} (点击修改)`;
    }
  }, 4000);

  if (!navigator.geolocation) {
    clearTimeout(fallbackTimer);
    locText.innerText = '中国石化 (点击修改)';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      clearTimeout(fallbackTimer);
      currentPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };

      if (amapKey) {
        searchAmapNearbyGasStations(currentPos.lng, currentPos.lat, amapKey);
      } else {
        const records = getRecords();
        const lastStation = records.length > 0 ? records[0].station : '中国石化加油站';
        currentStation = lastStation;
        locText.innerText = `${currentStation} (未配高德Key)`;
      }
    },
    () => {
      clearTimeout(fallbackTimer);
      locText.innerText = '中国石化 (点击修改)';
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

function searchAmapNearbyGasStations(lng, lat, key) {
  const locText = document.getElementById('locationText');
  const callbackName = 'onAmapPoiResponse_' + Date.now();

  window[callbackName] = function(data) {
    delete window[callbackName];
    const scriptEl = document.getElementById(callbackName);
    if (scriptEl) scriptEl.remove();

    if (data && data.status === '1' && data.pois && data.pois.length > 0) {
      nearbyStations = data.pois.map(p => ({
        name: p.name,
        address: p.address,
        distance: p.distance
      }));

      const nearest = nearbyStations[0];
      currentStation = nearest.name;
      locText.innerText = `📍 ${currentStation} (${nearest.distance}米)`;
    } else if (data && data.info === 'INVALID_USER_KEY') {
      locText.innerText = '高德Key无效 (请核对设置)';
    } else {
      locText.innerText = '周边加油站 (点击手动输入)';
    }
  };

  const script = document.createElement('script');
  script.id = callbackName;
  script.src = `https://restapi.amap.com/v3/place/around?key=${key}&location=${lng},${lat}&keywords=加油站&types=010100&radius=3000&sortrule=distance&offset=6&page=1&extensions=base&output=json&callback=${callbackName}`;
  script.onerror = () => {
    locText.innerText = '中国石化 (高德网络受阻)';
  };
  document.body.appendChild(script);
}

function editLocation() {
  if (nearbyStations && nearbyStations.length > 0) {
    let optionsText = '周边检测到以下加油站，请输入序号选择，或直接输入新名字：\n';
    nearbyStations.forEach((s, idx) => {
      optionsText += `${idx + 1}. ${s.name} (${s.distance}米)\n`;
    });
    const input = prompt(optionsText, '1');
    if (!input) return;

    const num = parseInt(input.trim());
    if (!isNaN(num) && num >= 1 && num <= nearbyStations.length) {
      currentStation = nearbyStations[num - 1].name;
    } else {
      currentStation = input.trim();
    }
  } else {
    const newName = prompt('请输入当前加油站名称：', currentStation);
    if (newName && newName.trim()) {
      currentStation = newName.trim();
    }
  }
  document.getElementById('locationText').innerText = currentStation;
}

// 4. 油品标号选择
function selectOil(btn, oil) {
  document.querySelectorAll('.oil-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentOil = oil;
}

// 5. 联动计算油耗金额、升数与单价
function calcFuelData(source) {
  const amount = parseFloat(document.getElementById('inputAmount').value) || 0;
  const price = parseFloat(document.getElementById('inputPrice').value) || 0;
  const volume = parseFloat(document.getElementById('inputVolume').value) || 0;

  if (source === 'amount' && price > 0) {
    document.getElementById('inputVolume').value = (amount / price).toFixed(2);
  } else if (source === 'price' && amount > 0) {
    document.getElementById('inputVolume').value = (amount / price).toFixed(2);
  } else if (source === 'volume' && price > 0 && amount === 0) {
    document.getElementById('inputAmount').value = (volume * price).toFixed(2);
  }
  onInputChanged();
}

// 6. 即时演算卡片更新
function onInputChanged() {
  const records = getRecords();
  const lastRecord = records.length > 0 ? records[0] : null;
  const baseMileage = parseFloat(localStorage.getItem(SETTINGS_KEY + '_base_mileage')) || (lastRecord ? lastRecord.mileage : 0);

  const currMileage = parseFloat(document.getElementById('inputMileage').value) || 0;
  const volume = parseFloat(document.getElementById('inputVolume').value) || 0;
  const amount = parseFloat(document.getElementById('inputAmount').value) || 0;
  const isFull = document.getElementById('switchFull').checked;

  const previewTrip = document.getElementById('previewTrip');
  const previewL100 = document.getElementById('previewL100');
  const previewPerKm = document.getElementById('previewPerKm');

  if (currMileage > 0 && baseMileage > 0 && currMileage > baseMileage) {
    const trip = currMileage - baseMileage;
    previewTrip.innerText = `${trip.toFixed(1)} km`;

    if (isFull && volume > 0) {
      const l100 = (volume / trip) * 100;
      previewL100.innerText = `${l100.toFixed(2)} L/100km`;
    } else {
      previewL100.innerText = isFull ? '--' : '非加满 (下次合并)';
    }

    if (amount > 0) {
      const perKm = amount / trip;
      previewPerKm.innerText = `¥${perKm.toFixed(2)}/km`;
    } else {
      previewPerKm.innerText = '--';
    }
  } else {
    previewTrip.innerText = baseMileage > 0 ? '需高于上次里程' : '首笔基准记录';
    previewL100.innerText = '--';
    previewPerKm.innerText = '--';
  }
}

// 7. 相机唤起与本地压缩
function triggerCamera(type) {
  if (type === 'dashboard') {
    document.getElementById('cameraDashboard').click();
  } else {
    document.getElementById('cameraMeter').click();
  }
}

function handleImageCaptured(input, type) {
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 800;
      let width = img.width;
      let height = img.height;
      if (width > height && width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else if (height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);

      currentPhotos[type] = compressedDataUrl;
      renderPhotoThumb(type, compressedDataUrl);
      runOcrRecognition(type, compressedDataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function renderPhotoThumb(type, dataUrl) {
  const container = document.getElementById(type === 'dashboard' ? 'dashPhotoThumb' : 'meterPhotoThumb');
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;">
      <img src="${dataUrl}" class="photo-thumb" />
      <span class="badge-ocr" id="badge_${type}">已留存照片</span>
    </div>
  `;
}

// 8. 智能视觉识别
async function runOcrRecognition(type, base64Image) {
  const settings = getSettings();
  const badge = document.getElementById(`badge_${type}`);

  if (!settings.apiKey) {
    if (badge) {
      badge.innerText = '照片已留存 (未配Key)';
      badge.style.background = 'var(--text-muted)';
    }
    return;
  }

  if (badge) {
    badge.innerText = 'AI 识别中...';
    badge.style.background = 'var(--primary)';
  }

  try {
    let baseUrl = (settings.baseUrl || 'https://api.siliconflow.cn/v1').trim();
    baseUrl = baseUrl.replace(/\/+$/, '');
    if (baseUrl.endsWith('/chat/completions')) {
      baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
    }
    const endpoint = `${baseUrl}/chat/completions`;
    const model = (settings.model || 'Qwen/Qwen2-VL-7B-Instruct').trim();

    const promptText = type === 'dashboard' 
      ? '请仔细识别图片中汽车仪表盘上的总里程数字（公里数km，通常显示在ODO或总里程旁边）。只输出纯JSON，不要输出markdown代码块，格式例如：{"mileage": 12345}'
      : '请仔细识别图片中加油机屏幕上的总金额(元)、加油升数(L)和单价(元/L)。只输出纯JSON，不要输出markdown代码块，格式例如：{"amount": 300.0, "volume": 39.5, "price": 7.59}';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              { type: 'image_url', image_url: { url: base64Image } }
            ]
          }
        ],
        temperature: 0.1
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.message || errJson.error?.message || errMsg;
      } catch (e) {}

      if (res.status === 400 && (errMsg.includes('support') || errMsg.includes('image') || errMsg.includes('vision') || errMsg.includes('parameter'))) {
        alert(`【模型不支持视觉】当前模型 "${model}" 不支持图片！\n请在设置中将模型改为 Qwen/Qwen2-VL-7B-Instruct。`);
      } else if (res.status === 401) {
        alert('【API Key 错误】提示 401 未授权，请检查设置里的 API Key。');
      } else {
        alert(`API 识别失败: ${errMsg}`);
      }

      if (badge) {
        badge.innerText = '识别出错，请手动输入';
        badge.style.background = 'var(--accent-orange)';
      }
      return;
    }

    const data = await res.json();
    const rawContent = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';

    const jsonMatch = rawContent.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error('未从 AI 回复中提取到标准 JSON 数据');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (type === 'dashboard' && parsed.mileage) {
      const parsedMileage = parseFloat(parsed.mileage);
      if (!isNaN(parsedMileage)) {
        document.getElementById('inputMileage').value = parsedMileage;
        if (badge) badge.innerText = '✓ 已识别里程';
      }
    } else if (type === 'meter') {
      let recognizedCount = 0;
      if (parsed.amount) {
        document.getElementById('inputAmount').value = parseFloat(parsed.amount);
        recognizedCount++;
      }
      if (parsed.price) {
        document.getElementById('inputPrice').value = parseFloat(parsed.price);
        recognizedCount++;
      }
      if (parsed.volume) {
        document.getElementById('inputVolume').value = parseFloat(parsed.volume);
        recognizedCount++;
      }
      if (badge) badge.innerText = recognizedCount > 0 ? '✓ 已识别加油机' : '未提取到数据';
    }
    onInputChanged();
  } catch (err) {
    console.error('OCR Error:', err);
    if (badge) {
      badge.innerText = '请手动核对数值';
      badge.style.background = 'var(--accent-orange)';
    }
    alert(`识别解析失败: ${err.message || '网络超时'}\n可直接手动填写。`);
  }
}

// 9. 保存记录
function saveRecord() {
  const mileage = parseFloat(document.getElementById('inputMileage').value);
  const amount = parseFloat(document.getElementById('inputAmount').value);
  const price = parseFloat(document.getElementById('inputPrice').value) || 0;
  const volume = parseFloat(document.getElementById('inputVolume').value) || 0;
  const isFull = document.getElementById('switchFull').checked;
  const actualPay = parseFloat(document.getElementById('inputActualPay').value) || amount;

  if (!mileage || mileage <= 0) {
    alert('请输入或拍摄有效的当前总里程！');
    return;
  }
  if (!amount || amount <= 0) {
    alert('请输入有效的加油金额！');
    return;
  }

  const records = getRecords();
  const last = records.length > 0 ? records[0] : null;

  let trip = 0;
  let l100 = 0;
  let perKm = 0;

  if (last && mileage > last.mileage) {
    trip = mileage - last.mileage;
    if (isFull && volume > 0) {
      l100 = (volume / trip) * 100;
    }
    perKm = amount / trip;
  }

  const recordItem = {
    id: Date.now(),
    date: new Date().toISOString(),
    station: currentStation,
    oil: currentOil,
    mileage: mileage,
    amount: amount,
    price: price,
    volume: volume,
    isFull: isFull,
    actualPay: actualPay,
    trip: trip,
    l100: l100,
    perKm: perKm,
    photos: { ...currentPhotos }
  };

  records.unshift(recordItem);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));

  alert('本次加油记录已成功保存！');
  resetForm();
  renderStats();
  renderHistory();
  switchTab('history');
}

function resetForm() {
  document.getElementById('inputMileage').value = '';
  document.getElementById('inputAmount').value = '';
  document.getElementById('inputPrice').value = '';
  document.getElementById('inputVolume').value = '';
  document.getElementById('inputActualPay').value = '';
  document.getElementById('dashPhotoThumb').innerHTML = '';
  document.getElementById('meterPhotoThumb').innerHTML = '';
  currentPhotos = { dashboard: null, meter: null };
  onInputChanged();
}

// 10. 渲染统计面板
function renderStats() {
  const records = getRecords();
  if (records.length === 0) {
    document.getElementById('statTotalMileage').innerText = '0 km';
    document.getElementById('statAvgL100').innerText = '- L';
    document.getElementById('statMonthCost').innerText = '¥0';
    return;
  }

  document.getElementById('statTotalMileage').innerText = `${records[0].mileage} km`;

  const validL100Records = records.filter(r => r.l100 > 0);
  if (validL100Records.length > 0) {
    document.getElementById('statAvgL100').innerText = `${validL100Records[0].l100.toFixed(2)} L`;
  } else {
    document.getElementById('statAvgL100').innerText = '- L';
  }

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthCost = records
    .filter(r => {
      const d = new Date(r.date);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    })
    .reduce((sum, r) => sum + (r.actualPay || r.amount), 0);

  document.getElementById('statMonthCost').innerText = `¥${monthCost.toFixed(0)}`;
}

// 11. 渲染历史列表
function renderHistory() {
  const records = getRecords();
  const container = document.getElementById('historyListContainer');
  if (records.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding: 40px 0; color:var(--text-muted); font-size:14px;">
        暂无加油记录，点击底部“快速记账”开始记录第一笔吧！
      </div>
    `;
    return;
  }

  container.innerHTML = records.map(r => {
    const d = new Date(r.date);
    const dateStr = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const hasPhoto = r.photos && (r.photos.dashboard || r.photos.meter);

    return `
      <div class="history-card">
        <div class="history-head">
          <div>
            <span class="history-date">${dateStr}</span>
            <span style="font-size:11px; background:var(--primary-light); color:var(--primary); padding:2px 6px; border-radius:6px; margin-left:6px;">${r.oil}</span>
            ${r.isFull ? '<span style="font-size:11px; background:#EBF9F1; color:#34C759; padding:2px 6px; border-radius:6px; margin-left:4px;">满油</span>' : ''}
          </div>
          <button class="btn-del" onclick="deleteRecord(${r.id})">删除</button>
        </div>
        <div class="history-station">📍 ${r.station || '加油站'} · 里程: ${r.mileage} km</div>
        
        <div class="history-details">
          <div>
            <div class="val">¥${r.amount.toFixed(1)}</div>
            <div class="lbl">消费金额</div>
          </div>
          <div>
            <div class="val">${r.volume.toFixed(1)}L</div>
            <div class="lbl">加油升数</div>
          </div>
          <div>
            <div class="val">${r.trip > 0 ? r.trip.toFixed(0) + 'km' : '--'}</div>
            <div class="lbl">区间续航</div>
          </div>
          <div>
            <div class="val" style="color:var(--accent-green);">${r.l100 > 0 ? r.l100.toFixed(1) : '--'}</div>
            <div class="lbl">百公里油耗</div>
          </div>
        </div>

        ${hasPhoto ? `
          <div style="display:flex; gap:8px; margin: 8px 0;">
            ${r.photos.dashboard ? `<img src="${r.photos.dashboard}" class="photo-thumb" title="仪表盘照片" onclick="previewImage('${r.photos.dashboard}')">` : ''}
            ${r.photos.meter ? `<img src="${r.photos.meter}" class="photo-thumb" title="加油机照片" onclick="previewImage('${r.photos.meter}')">` : ''}
          </div>
        ` : ''}

        <div class="history-footer">
          <span>单价: ¥${r.price ? r.price.toFixed(2) : '--'}/L</span>
          <span>每公里成本: ${r.perKm > 0 ? '¥' + r.perKm.toFixed(2) : '--'}</span>
        </div>
      </div>
    `;
  }).join('');
}

function deleteRecord(id) {
  if (!confirm('确定要删除这笔记录吗？')) return;
  let records = getRecords();
  records = records.filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  renderStats();
  renderHistory();
}

function previewImage(src) {
  const w = window.open('');
  w.document.write(`<img src="${src}" style="max-width:100%; height:auto; display:block; margin:auto;" />`);
}

// 12. 视图切换
function switchTab(tab) {
  const vRecord = document.getElementById('viewRecord');
  const vHistory = document.getElementById('viewHistory');
  const btnRecord = document.getElementById('tabBtnRecord');
  const btnHistory = document.getElementById('tabBtnHistory');

  if (tab === 'record') {
    vRecord.style.display = 'block';
    vHistory.style.display = 'none';
    btnRecord.classList.add('active');
    btnHistory.classList.remove('active');
  } else {
    vRecord.style.display = 'none';
    vHistory.style.display = 'block';
    btnRecord.classList.remove('active');
    btnHistory.classList.add('active');
  }
}

// 13. 数据导入与导出
function exportCSV() {
  const records = getRecords();
  if (records.length === 0) {
    alert('暂无数据可导出！');
    return;
  }
  let csv = '\uFEFF日期,加油站,油号,当前总里程(km),金额(元),升数(L),单价(元/L),区间续航(km),百公里油耗(L/100km),每公里成本(元)\n';
  records.forEach(r => {
    csv += `"${r.date}","${r.station}","${r.oil}",${r.mileage},${r.amount},${r.volume},${r.price},${r.trip},${r.l100.toFixed(2)},${r.perKm.toFixed(2)}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `加油记录_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
}

function exportJSON() {
  const records = getRecords();
  const settings = getSettings();
  const bundle = { records, settings };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `FuelUp_Backup_${new Date().toISOString().slice(0,10)}.json`;
  link.click();
}

function importJSON(input) {
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const bundle = JSON.parse(e.target.result);
      if (bundle.records) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle.records));
        if (bundle.settings) {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(bundle.settings));
        }
        alert('数据恢复成功！');
        renderStats();
        renderHistory();
        dismissSettingsModal();
      }
    } catch(err) {
      alert('导入失败，文件内容有误！');
    }
  };
  reader.readAsText(file);
}

// 14. 设置弹窗管理与掩码控制
function getRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function loadSettings() {
  const base = localStorage.getItem(SETTINGS_KEY + '_base_mileage');
  if (base) {
    const el = document.getElementById('settingBaseMileage');
    if (el) el.value = base;
  }
}

function openSettingsModal() {
  const settings = getSettings();
  const apiInput = document.getElementById('settingApiKey');
  const amapInput = document.getElementById('settingAmapKey');
  const badgeApi = document.getElementById('badgeApiStatus');
  const badgeAmap = document.getElementById('badgeAmapStatus');

  // AI 识图 Key 脱敏展示
  if (settings.apiKey && settings.apiKey.trim()) {
    apiInput.value = MASK_PLACEHOLDER;
    apiInput.dataset.masked = 'true';
    if (badgeApi) badgeApi.style.display = 'inline-block';
  } else {
    apiInput.value = '';
    apiInput.dataset.masked = 'false';
    if (badgeApi) badgeApi.style.display = 'none';
  }

  // 高德 Key 脱敏展示
  if (settings.amapKey && settings.amapKey.trim()) {
    amapInput.value = MASK_PLACEHOLDER;
    amapInput.dataset.masked = 'true';
    if (badgeAmap) badgeAmap.style.display = 'inline-block';
  } else {
    amapInput.value = '';
    amapInput.dataset.masked = 'false';
    if (badgeAmap) badgeAmap.style.display = 'none';
  }

  document.getElementById('settingBaseUrl').value = settings.baseUrl || 'https://api.siliconflow.cn/v1';
  document.getElementById('settingModel').value = settings.model || 'Qwen/Qwen2-VL-7B-Instruct';
  document.getElementById('settingBaseMileage').value = localStorage.getItem(SETTINGS_KEY + '_base_mileage') || '';
  document.getElementById('settingsModal').classList.add('show');
}

// 聚焦输入框时，如果是掩码，则自动清空供用户输入新Key
function handleKeyFocus(input) {
  if (input.dataset.masked === 'true') {
    input.value = '';
    input.dataset.masked = 'false';
  }
}

function handleKeyBlur(input) {
  // 如果失焦且为空，恢复掩码显示以表明原来已配置
  const settings = getSettings();
  const isAmap = input.id === 'settingAmapKey';
  const existingKey = isAmap ? settings.amapKey : settings.apiKey;
  if (!input.value.trim() && existingKey) {
    input.value = MASK_PLACEHOLDER;
    input.dataset.masked = 'true';
  }
}

// 切换密码显示与隐藏
function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPwd = input.type === 'password';
  input.type = isPwd ? 'text' : 'password';

  // 如果当前是掩码，并且用户切换到明文查看，展示真实 Key
  const settings = getSettings();
  const isAmap = inputId === 'settingAmapKey';
  const realKey = isAmap ? settings.amapKey : settings.apiKey;
  if (!isPwd) {
    // 切换回密文
    if (input.dataset.masked === 'true') {
      input.value = MASK_PLACEHOLDER;
    }
  } else {
    // 切换为明文查看
    if (input.dataset.masked === 'true' && realKey) {
      input.value = realKey;
    }
  }
}

// 右上角 X 直接关闭（不保存改动）
function dismissSettingsModal() {
  document.getElementById('settingsModal').classList.remove('show');
}

function setPresetConfig(preset) {
  if (preset === 'siliconflow') {
    document.getElementById('settingBaseUrl').value = 'https://api.siliconflow.cn/v1';
    document.getElementById('settingModel').value = 'Qwen/Qwen2-VL-7B-Instruct';
  } else if (preset === 'openai') {
    document.getElementById('settingBaseUrl').value = 'https://api.openai.com/v1';
    document.getElementById('settingModel').value = 'gpt-4o-mini';
  }
}

// 点击保存并生效
function closeSettingsModal() {
  const settings = getSettings();
  const apiInput = document.getElementById('settingApiKey');
  const amapInput = document.getElementById('settingAmapKey');

  // 判断是否输入了新 Key，还是保持原样掩码
  let newApiKey = settings.apiKey || '';
  if (apiInput.value.trim() && apiInput.value !== MASK_PLACEHOLDER) {
    newApiKey = apiInput.value.trim();
  } else if (!apiInput.value.trim() && apiInput.dataset.masked !== 'true') {
    newApiKey = '';
  }

  let newAmapKey = settings.amapKey || '';
  if (amapInput.value.trim() && amapInput.value !== MASK_PLACEHOLDER) {
    newAmapKey = amapInput.value.trim();
  } else if (!amapInput.value.trim() && amapInput.dataset.masked !== 'true') {
    newAmapKey = '';
  }

  const baseUrl = document.getElementById('settingBaseUrl').value.trim();
  const model = document.getElementById('settingModel').value.trim();
  const baseMileage = document.getElementById('settingBaseMileage').value.trim();

  const newSettings = {
    apiKey: newApiKey,
    amapKey: newAmapKey,
    baseUrl: baseUrl,
    model: model
  };

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
  if (baseMileage) {
    localStorage.setItem(SETTINGS_KEY + '_base_mileage', baseMileage);
  }

  dismissSettingsModal();
  onInputChanged();
  initLocation();
}

// 强制刷新
function forceUpdateApp() {
  const indicator = document.getElementById('ptrIndicator');
  const ptrText = document.getElementById('ptrText');
  if (indicator) {
    indicator.classList.add('refreshing');
    if (ptrText) ptrText.innerText = '正在刷新最新版本...';
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (let reg of registrations) {
        reg.update();
      }
    });
  }

  setTimeout(() => {
    window.location.reload();
  }, 400);
}

// 下拉刷新手势
function initPullToRefresh() {
  let startY = 0;
  let currentY = 0;
  let isPulling = false;
  const threshold = 65;

  const indicator = document.getElementById('ptrIndicator');
  const ptrText = document.getElementById('ptrText');
  const ptrArrow = document.querySelector('.ptr-arrow');

  window.addEventListener('touchstart', (e) => {
    if (window.scrollY <= 2 && e.touches.length === 1) {
      startY = e.touches[0].pageY;
      isPulling = true;
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    currentY = e.touches[0].pageY;
    const diff = currentY - startY;

    if (diff > 10 && window.scrollY <= 2) {
      const translateY = Math.min(diff * 0.45 - 50, 20);
      if (indicator) {
        indicator.classList.add('pulling');
        indicator.style.transform = `translateX(-50%) translateY(${translateY}px)`;
        if (diff > threshold) {
          if (ptrText) ptrText.innerText = '松开立即更新';
          if (ptrArrow) ptrArrow.style.transform = 'rotate(180deg)';
        } else {
          if (ptrText) ptrText.innerText = '下拉刷新应用';
          if (ptrArrow) ptrArrow.style.transform = 'rotate(0deg)';
        }
      }
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (!isPulling) return;
    const diff = currentY - startY;
    isPulling = false;

    if (diff > threshold && window.scrollY <= 2) {
      forceUpdateApp();
    } else {
      if (indicator) {
        indicator.style.transform = '';
        indicator.classList.remove('pulling');
      }
    }
    startY = 0;
    currentY = 0;
  });
}