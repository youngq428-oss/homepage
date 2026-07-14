(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // 컨테이너 프리셋 (내부 치수 cm, 최대 적재중량 kg — 업계 표준 참고치)
  // ---------------------------------------------------------------------
  var CONTAINER_PRESETS = [
    { id: "20gp", label: "20ft Dry (20GP)", length: 589.8, width: 235.2, height: 239.9, maxPayload: 28180 },
    { id: "40gp", label: "40ft Dry (40GP)", length: 1203.0, width: 235.2, height: 239.9, maxPayload: 28600 },
    { id: "40hc", label: "40ft High Cube (40HC)", length: 1203.0, width: 235.2, height: 269.9, maxPayload: 28600 }
  ];

  var COLOR_PALETTE = [
    0x4d8dff, 0xff6b6b, 0x38c976, 0xffb648, 0xb26bff,
    0x38c9c9, 0xff8ac2, 0xc9d038, 0x6b8dff, 0xff9a4d
  ];

  var presetSelect = document.getElementById("container-preset");
  var specText = document.getElementById("container-spec");
  var cargoTbody = document.getElementById("cargo-tbody");
  var addRowBtn = document.getElementById("add-row-btn");
  var calcBtn = document.getElementById("calc-btn");
  var statsPanel = document.getElementById("stats-panel");
  var statVolume = document.getElementById("stat-volume");
  var statWeight = document.getElementById("stat-weight");
  var statCount = document.getElementById("stat-count");
  var unpackedWrap = document.getElementById("unpacked-wrap");
  var unpackedList = document.getElementById("unpacked-list");

  // ---------------------------------------------------------------------
  // 컨테이너 프리셋 UI
  // ---------------------------------------------------------------------
  function initPresets() {
    CONTAINER_PRESETS.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      presetSelect.appendChild(opt);
    });
    presetSelect.addEventListener("change", updateSpecText);
    updateSpecText();
  }

  function getSelectedPreset() {
    var id = presetSelect.value;
    return CONTAINER_PRESETS.filter(function (p) { return p.id === id; })[0];
  }

  function updateSpecText() {
    var p = getSelectedPreset();
    specText.textContent =
      "내부 치수: " + p.length.toFixed(1) + " x " + p.width.toFixed(1) + " x " + p.height.toFixed(1) + " cm (L x W x H)  |  최대 적재중량: " + p.maxPayload.toLocaleString() + " kg";
  }

  // ---------------------------------------------------------------------
  // 화물 목록 테이블
  // ---------------------------------------------------------------------
  function addCargoRow(values) {
    values = values || {};
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input type="text" class="c-name" value="' + (values.name || "") + '"></td>' +
      '<td><input type="number" class="c-length" min="0" step="0.1" value="' + (values.length != null ? values.length : "") + '"></td>' +
      '<td><input type="number" class="c-width" min="0" step="0.1" value="' + (values.width != null ? values.width : "") + '"></td>' +
      '<td><input type="number" class="c-height" min="0" step="0.1" value="' + (values.height != null ? values.height : "") + '"></td>' +
      '<td><input type="number" class="c-weight" min="0" step="0.1" value="' + (values.weight != null ? values.weight : "") + '"></td>' +
      '<td><input type="number" class="c-qty" min="1" step="1" value="' + (values.qty != null ? values.qty : "") + '"></td>' +
      '<td><button type="button" class="remove-row-btn" title="행 삭제">✕</button></td>';
    tr.querySelector(".remove-row-btn").addEventListener("click", function () {
      tr.remove();
    });
    cargoTbody.appendChild(tr);
  }

  function readCargoRows() {
    var rows = [];
    cargoTbody.querySelectorAll("tr").forEach(function (tr) {
      var name = tr.querySelector(".c-name").value.trim();
      var length = parseFloat(tr.querySelector(".c-length").value);
      var width = parseFloat(tr.querySelector(".c-width").value);
      var height = parseFloat(tr.querySelector(".c-height").value);
      var weight = parseFloat(tr.querySelector(".c-weight").value);
      var qty = parseInt(tr.querySelector(".c-qty").value, 10);

      if (!name) name = "화물";
      if (!(length > 0) || !(width > 0) || !(height > 0) || !(weight >= 0) || !(qty > 0)) return;

      rows.push({ name: name, length: length, width: width, height: height, weight: weight, qty: qty });
    });
    return rows;
  }

  // ---------------------------------------------------------------------
  // Extreme Point 기반 3D 빈패킹
  // 좌표계: x = 길이(L), y = 높이(H, 수직), z = 너비(W)  — three.js의 y-up과 일치
  // ---------------------------------------------------------------------
  function pack(container, cargoRows) {
    var L = container.length, H = container.height, W = container.width;
    var eps = 1e-6;

    // 화물 목록을 개별 인스턴스로 전개
    var instances = [];
    var typeIndex = {};
    cargoRows.forEach(function (row, idx) {
      if (typeIndex[row.name] === undefined) typeIndex[row.name] = Object.keys(typeIndex).length;
      for (var i = 0; i < row.qty; i++) {
        instances.push({
          name: row.name,
          l: row.length,
          w: row.width,
          h: row.height,
          weight: row.weight,
          colorIndex: typeIndex[row.name] % COLOR_PALETTE.length,
          volume: row.length * row.width * row.height
        });
      }
    });

    // 부피 내림차순, 동률 시 최대 변 길이 내림차순
    instances.sort(function (a, b) {
      if (b.volume !== a.volume) return b.volume - a.volume;
      return Math.max(b.l, b.w, b.h) - Math.max(a.l, a.w, a.h);
    });

    var points = [{ x: 0, y: 0, z: 0 }];
    var placed = [];
    var totalWeight = 0;
    var unpackedCounts = {};

    function boxesOverlap(a, b) {
      return a.x < b.x + b.dx - eps && a.x + a.dx > b.x + eps &&
             a.y < b.y + b.dy - eps && a.y + a.dy > b.y + eps &&
             a.z < b.z + b.dz - eps && a.z + a.dz > b.z + eps;
    }

    function pointExists(p) {
      return points.some(function (q) {
        return Math.abs(q.x - p.x) < eps && Math.abs(q.y - p.y) < eps && Math.abs(q.z - p.z) < eps;
      });
    }

    instances.forEach(function (inst) {
      var orientations = [{ dx: inst.l, dy: inst.h, dz: inst.w }];
      if (inst.l !== inst.w) orientations.push({ dx: inst.w, dy: inst.h, dz: inst.l });

      var sortedPoints = points.slice().sort(function (a, b) {
        return a.y - b.y || a.z - b.z || a.x - b.x;
      });

      var placement = null;
      outer:
      for (var pi = 0; pi < sortedPoints.length; pi++) {
        var p = sortedPoints[pi];
        for (var oi = 0; oi < orientations.length; oi++) {
          var o = orientations[oi];
          if (p.x + o.dx > L + eps || p.y + o.dy > H + eps || p.z + o.dz > W + eps) continue;
          if (totalWeight + inst.weight > container.maxPayload + eps) continue;
          var candidate = { x: p.x, y: p.y, z: p.z, dx: o.dx, dy: o.dy, dz: o.dz };
          var collides = placed.some(function (b) { return boxesOverlap(candidate, b); });
          if (!collides) {
            placement = { point: p, box: candidate };
            break outer;
          }
        }
      }

      if (!placement) {
        unpackedCounts[inst.name] = (unpackedCounts[inst.name] || 0) + 1;
        return;
      }

      var b = placement.box;
      b.name = inst.name;
      b.weight = inst.weight;
      b.colorIndex = inst.colorIndex;
      placed.push(b);
      totalWeight += inst.weight;

      // 사용한 점 제거
      var usedIdx = points.indexOf(placement.point);
      if (usedIdx !== -1) points.splice(usedIdx, 1);

      // 새 extreme point 3개 생성
      var newPoints = [
        { x: b.x + b.dx, y: b.y, z: b.z },
        { x: b.x, y: b.y + b.dy, z: b.z },
        { x: b.x, y: b.y, z: b.z + b.dz }
      ];
      newPoints.forEach(function (np) {
        if (np.x <= L + eps && np.y <= H + eps && np.z <= W + eps && !pointExists(np)) {
          points.push(np);
        }
      });
    });

    var packedVolume = placed.reduce(function (s, b) { return s + b.dx * b.dy * b.dz; }, 0);
    var containerVolume = L * W * H;
    var totalCargoCount = instances.length;

    return {
      placed: placed,
      unpackedCounts: unpackedCounts,
      packedCount: placed.length,
      totalCount: totalCargoCount,
      volumeRatio: containerVolume > 0 ? packedVolume / containerVolume : 0,
      weightRatio: container.maxPayload > 0 ? totalWeight / container.maxPayload : 0
    };
  }

  // ---------------------------------------------------------------------
  // 결과 패널 렌더링
  // ---------------------------------------------------------------------
  function renderStats(result) {
    statsPanel.hidden = false;
    statVolume.textContent = (result.volumeRatio * 100).toFixed(1) + "%";
    statWeight.textContent = (result.weightRatio * 100).toFixed(1) + "%";
    statCount.textContent = result.packedCount + " / " + result.totalCount;

    var names = Object.keys(result.unpackedCounts);
    unpackedList.innerHTML = "";
    if (names.length === 0) {
      unpackedWrap.hidden = true;
    } else {
      unpackedWrap.hidden = false;
      names.forEach(function (name) {
        var li = document.createElement("li");
        li.textContent = name + " : " + result.unpackedCounts[name] + "개 미적재";
        unpackedList.appendChild(li);
      });
    }
  }

  // ---------------------------------------------------------------------
  // Three.js 3D 뷰
  // ---------------------------------------------------------------------
  var viewportEl = document.getElementById("viewport");
  var scene, camera, renderer, controls, boxGroup, containerGroup;

  function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1420);

    camera = new THREE.PerspectiveCamera(45, viewportEl.clientWidth / viewportEl.clientHeight, 1, 20000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(viewportEl.clientWidth, viewportEl.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    viewportEl.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    var ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    var dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 1.5, 1);
    scene.add(dir);

    containerGroup = new THREE.Group();
    boxGroup = new THREE.Group();
    scene.add(containerGroup);
    scene.add(boxGroup);

    window.addEventListener("resize", onResize);
    animate();
  }

  function onResize() {
    if (!viewportEl.clientWidth || !viewportEl.clientHeight) return;
    camera.aspect = viewportEl.clientWidth / viewportEl.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewportEl.clientWidth, viewportEl.clientHeight);
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  function clearGroup(group) {
    while (group.children.length) {
      var obj = group.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  }

  function renderScene(container, result) {
    clearGroup(containerGroup);
    clearGroup(boxGroup);

    var L = container.length, H = container.height, W = container.width;

    // 컨테이너 와이어프레임
    var contGeo = new THREE.BoxGeometry(L, H, W);
    var edges = new THREE.EdgesGeometry(contGeo);
    var wireMat = new THREE.LineBasicMaterial({ color: 0x4d8dff });
    var wireframe = new THREE.LineSegments(edges, wireMat);
    wireframe.position.set(L / 2, H / 2, W / 2);
    containerGroup.add(wireframe);
    contGeo.dispose();

    // 바닥 그리드
    var grid = new THREE.GridHelper(Math.max(L, W) * 1.2, 20, 0x262f45, 0x1a2133);
    grid.position.set(L / 2, 0, W / 2);
    containerGroup.add(grid);

    // 적재된 박스
    result.placed.forEach(function (b) {
      var geo = new THREE.BoxGeometry(b.dx, b.dy, b.dz);
      var color = COLOR_PALETTE[b.colorIndex];
      var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: 0.92 });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.x + b.dx / 2, b.y + b.dy / 2, b.z + b.dz / 2);
      boxGroup.add(mesh);

      var boxEdges = new THREE.EdgesGeometry(geo);
      var edgeLine = new THREE.LineSegments(boxEdges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 }));
      edgeLine.position.copy(mesh.position);
      boxGroup.add(edgeLine);
    });

    // 카메라 위치
    var maxDim = Math.max(L, H, W);
    camera.position.set(L * 1.3, H * 1.4, W * 1.8 + maxDim);
    controls.target.set(L / 2, H / 2, W / 2);
    controls.update();
  }

  // ---------------------------------------------------------------------
  // 이벤트 바인딩 및 초기화
  // ---------------------------------------------------------------------
  function runCalculation() {
    var container = getSelectedPreset();
    var cargoRows = readCargoRows();
    var result = pack(container, cargoRows);
    renderStats(result);
    renderScene(container, result);
  }

  addRowBtn.addEventListener("click", function () { addCargoRow(); });
  calcBtn.addEventListener("click", runCalculation);

  initPresets();
  addCargoRow({ name: "박스 A", length: 60, width: 40, height: 40, weight: 15, qty: 40 });
  addCargoRow({ name: "박스 B", length: 100, width: 80, height: 60, weight: 35, qty: 15 });
  initScene();
})();
