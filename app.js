// ============================================
// GEO CUBA - Juego de geolocalización
// ============================================

// --- 1. CONFIGURACIÓN DEL MAPA ---
const ESTILOS = {
  satelite: 'https://tiles.versatiles.org/assets/styles/satellite/style.json',
  colorido: 'https://tiles.versatiles.org/assets/styles/colorful/style.json',
  oscuro: 'https://tiles.versatiles.org/assets/styles/eclipse/style.json'
};

let estiloActual = 'satelite';

const map = new maplibregl.Map({
  container: 'map',
  style: ESTILOS[estiloActual],
  center: [-79.5, 21.5],
  zoom: 7,
  minZoom: 6,
  maxZoom: 14,
  attributionControl: false,
  // Optimizaciones para móvil
  fadeDuration: 100,
  antialias: false,
  refreshExpiredTiles: false
});

map.addControl(new maplibregl.NavigationControl({
  showCompass: false,
  visualizePitch: false
}), 'top-right');

// --- 2. MÓDULO DE AUDIO ---
const AUDIO = {
  click:     new Audio('audio/click.mp3'),
  correct:   new Audio('audio/correct.mp3'),
  incorrect: new Audio('audio/incorrect.mp3'),
  next:      new Audio('audio/next.mp3'),
  finish:    new Audio('audio/finish.mp3'),
  music:     new Audio('audio/music.mp3')
};

AUDIO.music.loop = true;
AUDIO.music.volume = 0.3;
AUDIO.click.volume = 0.5;
AUDIO.correct.volume = 0.7;
AUDIO.incorrect.volume = 0.6;
AUDIO.next.volume = 0.5;
AUDIO.finish.volume = 0.7;

Object.values(AUDIO).forEach(audio => {
  audio.preload = 'auto';
  audio.load();
});

function playSound(nombre) {
  if (!AUDIO[nombre] || nombre === 'music') return;
  const sonido = AUDIO[nombre];
  sonido.currentTime = 0;
  sonido.play().catch(err => console.warn('Audio bloqueado:', err.message));
}

let musicaActiva = false;

function iniciarMusica() {
  if (musicaActiva) return;
  AUDIO.music.play()
    .then(() => { musicaActiva = true; actualizarBotonMusica(); })
    .catch(err => console.warn('Autoplay bloqueado:', err.message));
}

function pausarMusica() {
  AUDIO.music.pause();
  musicaActiva = false;
  actualizarBotonMusica();
}

function alternarMusica() {
  musicaActiva ? pausarMusica() : iniciarMusica();
}

function actualizarBotonMusica() {
  const btn = document.getElementById('btn-musica');
  if (btn) btn.textContent = musicaActiva ? '🔊 Música' : '🔇 Música';
}

// Desbloquear audio al primer toque en móviles
document.addEventListener('touchstart', function desbloquearAudio() {
  Object.values(AUDIO).forEach(audio => {
    audio.load();
  });
  document.removeEventListener('touchstart', desbloquearAudio);
}, { once: true, passive: true });

// --- 3. ESTADO DEL JUEGO ---
let preguntas = [];
let preguntaActual = 0;
let puntuacion = 0;
let respuestaSeleccionada = null;
let marcadoresActivos = [];
let juegoTerminado = false;
let datosMunicipios = null;
let highlightLayers = [];
let categoriaActual = null;
let bancoHistoria = null;
let bancoUrbano = null;
let bancoDeporte = null;
let bancoFinanzas = null;
let historial = [];

// --- 4. BOTONES DE LA BARRA SUPERIOR ---
document.getElementById('btn-estilo').addEventListener('click', () => {
  playSound('click');
  const claves = Object.keys(ESTILOS);
  const indiceActual = claves.indexOf(estiloActual);
  estiloActual = claves[(indiceActual + 1) % claves.length];
  map.setStyle(ESTILOS[estiloActual]);
});

document.getElementById('btn-atras').addEventListener('click', () => {
  playSound('click');
  volverAlMenu();
});

document.getElementById('btn-musica').addEventListener('click', () => {
  playSound('click');
  alternarMusica();
});

document.getElementById('btn-volver-menu').addEventListener('click', () => {
  playSound('click');
  volverAlMenu();
});

function volverAlMenu() {
  juegoTerminado = false;
  respuestaSeleccionada = null;
  categoriaActual = null;
  historial = [];

  marcadoresActivos.forEach(m => m.remove());
  marcadoresActivos = [];

  for (let i = 0; i < preguntas.length; i++) {
    const lineaId = `linea-${i}`;
    if (map.getLayer(lineaId)) map.removeLayer(lineaId);
    if (map.getSource(lineaId)) map.removeSource(lineaId);
  }

  limpiarHighlights();
  map.flyTo({ center: [-79.5, 21.5], zoom: 7, duration: 600 });

  document.getElementById('menu-principal').classList.remove('oculto');
  document.getElementById('top-bar').style.display = 'none';
  document.getElementById('pregunta-container').style.display = 'none';
  document.getElementById('resultado-overlay').style.display = 'none';
  ocultarPanelPuntos();
}

// --- 5. CALCULAR CENTROIDE ---
function calcularCentroide(coordenadas) {
  if (!coordenadas || coordenadas.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const anillo = coordenadas[0];
  if (!anillo) return null;
  for (const punto of anillo) {
    const [x, y] = punto;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

// --- 6. CARGA INICIAL ---
map.on('load', () => {
  console.log('✅ Mapa cargado');

  fetch('map/cuba-municipios.geojson')
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(data => {
      datosMunicipios = data;
      dibujarCapasBase();
      console.log('✅ Municipios cargados');
    })
    .catch(err => console.error('❌ Error cargando municipios:', err));

  Promise.all([
    fetch('data/preguntas-historia.json')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .catch(err => { console.error('❌ HISTORIA:', err); return null; }),
    fetch('data/preguntas-urbano.json')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .catch(err => { console.error('❌ URBANO:', err); return null; }),
    fetch('data/preguntas-deporte.json')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .catch(err => { console.error('❌ DEPORTE:', err); return null; }),
    fetch('data/preguntas-finanzas.json')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .catch(err => { console.error('❌ FINANZAS:', err); return null; })
  ]).then(([historia, urbano, deporte, finanzas]) => {
    bancoHistoria = historia;
    bancoUrbano = urbano;
    bancoDeporte = deporte;
    bancoFinanzas = finanzas;
    console.log('✅ Bancos cargados:', {
      historia: historia ? historia.length : 'ERROR',
      urbano: urbano ? urbano.length : 'ERROR',
      deporte: deporte ? deporte.length : 'ERROR',
      finanzas: finanzas ? finanzas.length : 'ERROR'
    });
  });
});

map.on('style.load', () => {
  highlightLayers = [];
  if (datosMunicipios) dibujarCapasBase();
});

map.on('error', (e) => console.error('Error en el mapa:', e.error));

// --- 7. DIBUJAR CAPAS BASE ---
function dibujarCapasBase() {
  if (map.getSource('cuba-provincias')) return;

  map.addSource('cuba-provincias', { type: 'geojson', data: 'map/cuba-provincias.geojson' });
  map.addLayer({
    id: 'provincias-fill', type: 'fill', source: 'cuba-provincias',
    paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.1 }
  });
  map.addLayer({
    id: 'provincias-outline', type: 'line', source: 'cuba-provincias',
    paint: { 'line-color': '#2c5aa0', 'line-width': 1.5 }
  });

  map.addSource('cuba-municipios', { type: 'geojson', data: datosMunicipios });
  map.addLayer({
    id: 'municipios-fill', type: 'fill', source: 'cuba-municipios',
    paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.05 }
  });
  map.addLayer({
    id: 'municipios-outline', type: 'line', source: 'cuba-municipios',
    paint: { 'line-color': '#1a3a6b', 'line-width': 0.5 }
  });

  const etiquetasGeoJSON = {
    type: 'FeatureCollection',
    features: datosMunicipios.features.map(feature => {
      const coords = feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates[0];
      const centro = calcularCentroide(coords);
      if (!centro) return null;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: centro },
        properties: { nombre: feature.properties.municipality || feature.properties.name || 'Sin nombre' }
      };
    }).filter(f => f !== null)
  };

  map.addSource('etiquetas-municipios', { type: 'geojson', data: etiquetasGeoJSON });
  map.addLayer({
    id: 'municipios-labels', type: 'symbol', source: 'etiquetas-municipios',
    layout: {
      'text-field': ['get', 'nombre'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-anchor': 'center',
      'text-allow-overlap': false,
      'text-padding': 4
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 2 }
  });
}

// --- 8. RESALTAR MUNICIPIO ---
function animarCapa(layerId, propiedad, valorFinal, duracion = 600) {
  let valor = 0;
  const pasos = 20;
  const incremento = valorFinal / pasos;
  const intervalo = duracion / pasos;
  const anim = setInterval(() => {
    valor += incremento;
    if (valor >= valorFinal) { valor = valorFinal; clearInterval(anim); }
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, propiedad, valor);
    else clearInterval(anim);
  }, intervalo);
}

function resaltarMunicipio(nombre, provincia, color) {
  if (!nombre || !provincia) return null;
  const id = `highlight-${nombre.replace(/\s+/g, '-')}-${color.replace('#', '')}`;
  if (map.getLayer(`${id}-fill`)) return id;

  const features = datosMunicipios.features.filter(f =>
    f.properties.municipality === nombre && f.properties.province === provincia
  );
  if (features.length === 0) return null;

  map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addLayer({
    id: `${id}-fill`, type: 'fill', source: id,
    paint: { 'fill-color': color, 'fill-opacity': 0 }
  });
  map.addLayer({
    id: `${id}-outline`, type: 'line', source: id,
    paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0 }
  });

  animarCapa(`${id}-fill`, 'fill-opacity', 0.6);
  animarCapa(`${id}-outline`, 'line-opacity', 1);
  highlightLayers.push(id);
  return id;
}

function limpiarHighlights() {
  highlightLayers.forEach(id => {
    if (map.getLayer(`${id}-outline`)) map.removeLayer(`${id}-outline`);
    if (map.getLayer(`${id}-fill`)) map.removeLayer(`${id}-fill`);
    if (map.getSource(id)) map.removeSource(id);
  });
  highlightLayers = [];
}

// --- 9. PANEL DE PUNTOS ---
function mostrarPanelPuntos() { document.getElementById('puntos-panel').style.display = 'flex'; }
function ocultarPanelPuntos() { document.getElementById('puntos-panel').style.display = 'none'; }
function resetearPuntosPanel() {
  document.getElementById('puntos-valor').textContent = '0';
  document.getElementById('puntos-historial').innerHTML = '';
  const panel = document.getElementById('puntos-panel');
  panel.classList.remove('casino', 'casino-suave');
}

function animarContador(elemento, desde, hasta, duracion) {
  const inicio = performance.now();
  const diferencia = hasta - desde;
  function paso(ahora) {
    const progreso = Math.min((ahora - inicio) / duracion, 1);
    elemento.textContent = Math.round(desde + diferencia * progreso);
    if (progreso < 1) requestAnimationFrame(paso);
  }
  requestAnimationFrame(paso);
}

function actualizarPuntosPanel(puntaje, distancia) {
  const panel = document.getElementById('puntos-panel');
  const valor = document.getElementById('puntos-valor');
  const historialPanel = document.getElementById('puntos-historial');

  const valorAnterior = parseInt(valor.textContent) || 0;
  animarContador(valor, valorAnterior, valorAnterior + puntaje, 600);

  let clase = 'rojo';
  if (distancia < 20) clase = 'verde';
  else if (distancia < 60) clase = 'amarillo';
  else if (distancia < 150) clase = 'naranja';

  const item = document.createElement('span');
  item.className = 'puntos-item ' + clase;
  item.textContent = '+' + puntaje;
  historialPanel.appendChild(item);

  while (historialPanel.children.length > 5) {
    historialPanel.removeChild(historialPanel.firstChild);
  }

  panel.classList.remove('casino', 'casino-suave');
  void panel.offsetWidth;
  if (clase === 'verde') panel.classList.add('casino');
  else if (clase === 'amarillo') panel.classList.add('casino-suave');
}

// --- 10. SELECCIÓN DE CATEGORÍA ---
document.querySelectorAll('.btn-categoria').forEach(btn => {
  btn.addEventListener('click', () => {
    playSound('click');
    iniciarMusica();
    categoriaActual = btn.dataset.categoria;

    let banco;
    if (categoriaActual === 'urbano') banco = bancoUrbano;
    else if (categoriaActual === 'deporte') banco = bancoDeporte;
    else if (categoriaActual === 'finanzas') banco = bancoFinanzas;
    else banco = bancoHistoria;

    if (!banco || banco.length === 0) {
      alert('⚠️ No se pudieron cargar las preguntas de "' + categoriaActual + '".');
      return;
    }

    document.getElementById('menu-principal').classList.add('oculto');
    document.getElementById('top-bar').style.display = 'flex';
    document.getElementById('pregunta-container').style.display = 'flex';
    document.getElementById('resultado-overlay').style.display = 'none';
    mostrarPanelPuntos();
    resetearPuntosPanel();

    preguntas = barajar([...banco]).slice(0, 5);
    preguntaActual = 0;
    puntuacion = 0;
    historial = [];
    juegoTerminado = false;
    mostrarPregunta();
  });
});

function barajar(array) {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// --- 11. MOSTRAR PREGUNTA ---
function mostrarPregunta() {
  marcadoresActivos.forEach(m => m.remove());
  marcadoresActivos = [];
  limpiarHighlights();
  respuestaSeleccionada = null;

  if (preguntaActual >= preguntas.length) {
    mostrarResultados();
    return;
  }

  const p = preguntas[preguntaActual];
  document.getElementById('pregunta-texto').innerHTML =
    `<strong>Pregunta ${preguntaActual + 1} de ${preguntas.length}</strong><br>${p.pregunta}`;

  const btn = document.getElementById('btn-siguiente');
  btn.disabled = true;
  btn.textContent = 'Siguiente';

  // Reanimar tarjeta de preguntas al cambiar de pregunta
  const container = document.getElementById('pregunta-container');
  container.style.animation = 'none';
  void container.offsetWidth;
  container.style.animation = 'pregunta-entrada 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';

  map.flyTo({ center: [-79.5, 21.5], zoom: 7, duration: 800 });
}

// --- 12. CLIC EN EL MAPA ---
map.on('click', (e) => {
  if (respuestaSeleccionada || preguntaActual >= preguntas.length) return;
  if (!preguntas[preguntaActual]) return;

  playSound('click');

  const { lng, lat } = e.lngLat;
  const correcta = preguntas[preguntaActual].respuesta;
  const preguntaTexto = preguntas[preguntaActual].pregunta;

  const featuresClic = map.queryRenderedFeatures(e.point, { layers: ['municipios-fill'] });
  let municipioClic = null, provinciaClic = null;
  if (featuresClic.length > 0) {
    municipioClic = featuresClic[0].properties.municipality;
    provinciaClic = featuresClic[0].properties.province;
  }

  const distancia = calcularDistancia(lat, lng, correcta.lat, correcta.lng);
  const puntaje = Math.max(0, Math.round(5000 - distancia * 10));

  puntuacion += puntaje;
  respuestaSeleccionada = { lat, lng, distancia, puntaje };

  const acertada = distancia < 60;
  historial.push({
    numero: preguntaActual + 1,
    pregunta: preguntaTexto,
    distancia,
    puntaje,
    acertada,
    municipioCorrecto: correcta.municipio,
    provinciaCorrecta: correcta.provincia
  });

  if (acertada) {
    playSound('correct');
  } else {
    playSound('incorrect');
  }

  actualizarPuntosPanel(puntaje, distancia);

  if (municipioClic && provinciaClic) resaltarMunicipio(municipioClic, provinciaClic, '#e74c3c');
  resaltarMunicipio(correcta.municipio, correcta.provincia, '#27ae60');

  const marcadorJugador = new maplibregl.Marker({ color: '#e74c3c' })
    .setLngLat([lng, lat]).addTo(map);
  marcadoresActivos.push(marcadorJugador);

  const marcadorCorrecto = new maplibregl.Marker({ color: '#27ae60' })
    .setLngLat([correcta.lng, correcta.lat]).addTo(map);
  marcadoresActivos.push(marcadorCorrecto);

  const lineaId = `linea-${preguntaActual}`;
  map.addSource(lineaId, {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[lng, lat], [correcta.lng, correcta.lat]] }
    }
  });
  map.addLayer({
    id: lineaId, type: 'line', source: lineaId,
    paint: { 'line-color': '#e74c3c', 'line-width': 2, 'line-dasharray': [2, 2] }
  });

  const bounds = new maplibregl.LngLatBounds()
    .extend([lng, lat]).extend([correcta.lng, correcta.lat]);
  map.fitBounds(bounds, { padding: 80, duration: 1000 });

  let emoji = '⬛';
  if (distancia < 20) emoji = '🟩';
  else if (distancia < 60) emoji = '🟨';
  else if (distancia < 150) emoji = '🟧';
  else if (distancia < 500) emoji = '🟥';

  document.getElementById('pregunta-texto').innerHTML =
    `${emoji} Distancia: <strong>${distancia.toFixed(0)} km</strong><br>` +
    `Puntos: <strong>${puntaje}</strong><br>` +
    `<small>Respuesta correcta: ${correcta.municipio}, ${correcta.provincia}</small>`;

  document.getElementById('btn-siguiente').disabled = false;
});

// --- 13. HAVERSINE ---
function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- 14. BOTÓN SIGUIENTE ---
document.getElementById('btn-siguiente').addEventListener('click', () => {
  if (juegoTerminado) return;
  playSound('next');
  const lineaId = `linea-${preguntaActual}`;
  if (map.getLayer(lineaId)) map.removeLayer(lineaId);
  if (map.getSource(lineaId)) map.removeSource(lineaId);
  preguntaActual++;
  mostrarPregunta();
});

// --- 15. RESULTADOS ---
function mostrarResultados() {
  playSound('finish');
  juegoTerminado = true;
  limpiarHighlights();

  document.getElementById('pregunta-container').style.display = 'none';
  document.getElementById('resultado-overlay').style.display = 'flex';

  const maxPuntos = preguntas.length * 5000;
  const porcentaje = Math.round((puntuacion / maxPuntos) * 100);
  const acertadas = historial.filter(h => h.acertada).length;
  const falladas = historial.length - acertadas;

  let trofeo = '🎯';
  if (porcentaje >= 90) trofeo = '🏆';
  else if (porcentaje >= 75) trofeo = '🥇';
  else if (porcentaje >= 60) trofeo = '🥈';
  else if (porcentaje >= 40) trofeo = '🥉';
  else if (porcentaje >= 20) trofeo = '⭐';

  document.getElementById('resultado-trophy').textContent = trofeo;

  let nombreCat = 'Historia';
  if (categoriaActual === 'urbano') nombreCat = 'Urbano';
  else if (categoriaActual === 'deporte') nombreCat = 'Deporte';
  else if (categoriaActual === 'finanzas') nombreCat = 'Finanzas y Empresas';

  document.getElementById('resultado-categoria').textContent = nombreCat;
  document.getElementById('resultado-puntos').textContent = puntuacion;
  document.getElementById('resultado-max').textContent = '/' + maxPuntos;
  document.getElementById('resultado-precision').textContent = porcentaje + '% precisión';
  document.getElementById('stat-acertadas').textContent = acertadas;
  document.getElementById('stat-falladas').textContent = falladas;

  const hoy = new Date();
  const fecha = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
  document.getElementById('resultado-fecha').textContent = fecha;

  const listaResumen = document.getElementById('resumen-lista');
  listaResumen.innerHTML = '';

  historial.forEach(item => {
    let emoji = '⬛';
    let clase = 'rojo';
    if (item.distancia < 20) { emoji = '🟩'; clase = 'verde'; }
    else if (item.distancia < 60) { emoji = '🟨'; clase = 'amarillo'; }
    else if (item.distancia < 150) { emoji = '🟧'; clase = 'naranja'; }

    const fila = document.createElement('div');
    fila.className = 'resumen-fila';
    fila.innerHTML =
      `<span class="resumen-emoji">${emoji}</span>` +
      `<div class="resumen-contenido">` +
        `<div class="resumen-pregunta">${item.pregunta}</div>` +
        `<div class="resumen-respuesta">${item.municipioCorrecto}, ${item.provinciaCorrecta}</div>` +
      `</div>` +
      `<span class="resumen-puntos ${clase}">+${item.puntaje}</span>`;
    listaResumen.appendChild(fila);
  });
}

// --- 16. GENERAR CAPTURA 4:5 ---
async function generarCaptura() {
  const card = document.getElementById('resultado-card');
  const estilosPrevios = card.getAttribute('style') || '';

  card.classList.add('capturando');
  card.style.width = '540px';
  card.style.height = '675px';
  card.style.aspectRatio = 'auto';

  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 120));

  try {
    const canvas = await html2canvas(card, {
      backgroundColor: '#0a0e1a',
      scale: 2,
      useCORS: true,
      logging: false,
      allowTaint: false,
      imageTimeout: 0,
      removeContainer: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: card.scrollWidth,
      windowHeight: card.scrollHeight,
      onclone: (clonedDoc) => {
        const clonedCard = clonedDoc.getElementById('resultado-card');
        if (!clonedCard) return;

        clonedCard.style.width = '540px';
        clonedCard.style.height = '675px';
        clonedCard.style.aspectRatio = 'auto';
        clonedCard.style.display = 'flex';
        clonedCard.style.flexDirection = 'column';
        clonedCard.style.overflow = 'hidden';
        clonedCard.style.fontSize = '14px';
        clonedCard.style.padding = '22px 24px';
        clonedCard.style.gap = '10px';

        const lista = clonedCard.querySelector('.resumen-lista');
        if (lista) {
          lista.style.flex = '0 0 310px';
          lista.style.height = '310px';
          lista.style.minHeight = '310px';
          lista.style.maxHeight = '310px';
          lista.style.display = 'flex';
          lista.style.flexDirection = 'column';
          lista.style.gap = '6px';
          lista.style.overflow = 'hidden';
        }

        clonedCard.querySelectorAll('.resumen-fila').forEach(fila => {
          fila.style.display = 'grid';
          fila.style.gridTemplateColumns = '22px 1fr auto';
          fila.style.gap = '8px';
          fila.style.alignItems = 'center';
          fila.style.padding = '8px 10px';
          fila.style.minHeight = '54px';
          fila.style.maxHeight = '54px';
          fila.style.opacity = '1';
          fila.style.transform = 'none';
          fila.style.animation = 'none';
        });

        const acciones = clonedCard.querySelector('.resultado-acciones');
        const volver = clonedCard.querySelector('#btn-volver-menu');
        if (acciones) acciones.style.display = 'none';
        if (volver) volver.style.display = 'none';
      }
    });

    return canvas;
  } finally {
    card.classList.remove('capturando');
    card.setAttribute('style', estilosPrevios);
  }
}

// --- 17. COMPARTIR LOGROS ---
document.getElementById('btn-compartir').addEventListener('click', async () => {
  playSound('click');
  const btn = document.getElementById('btn-compartir');
  const textoOriginal = btn.innerHTML;

  btn.disabled = true;
  btn.textContent = '✦ Generando... ✦';

  try {
    const canvas = await generarCaptura();

    canvas.toBlob(async (blob) => {
      if (!blob) throw new Error('No se pudo crear la imagen');

      const file = new File([blob], 'geo-cuba-logros.png', { type: 'image/png' });
      let nombreCategoria = 'Historia';
      if (categoriaActual === 'urbano') nombreCategoria = 'Urbano';
      else if (categoriaActual === 'deporte') nombreCategoria = 'Deporte';
      else if (categoriaActual === 'finanzas') nombreCategoria = 'Finanzas y Empresas';
      const textoCompartir = `🎮 Geo Cuba ${nombreCategoria} — ¡Mirá mis logros! 🗺️`;

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'Geo Cuba - Mis logros',
            text: textoCompartir
          });
        } catch (err) {
          if (err.name !== 'AbortError') console.error('Error al compartir:', err);
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `geo-cuba-${nombreCategoria.toLowerCase().replace(/\s+/g, '-')}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      btn.innerHTML = textoOriginal;
      btn.disabled = false;
    }, 'image/png');

  } catch (err) {
    console.error('Error generando la imagen:', err);
    btn.innerHTML = textoOriginal;
    btn.disabled = false;
    alert('No se pudo generar la imagen. Intenta de nuevo.');
  }
});

// --- 18. DESCARGAR CAPTURA ---
document.getElementById('btn-descargar').addEventListener('click', async () => {
  playSound('click');
  const btn = document.getElementById('btn-descargar');
  const textoOriginal = btn.innerHTML;

  btn.disabled = true;
  btn.textContent = '⬇ Generando...';

  try {
    const canvas = await generarCaptura();
    let nombreCategoria = 'historia';
    if (categoriaActual === 'urbano') nombreCategoria = 'urbano';
    else if (categoriaActual === 'deporte') nombreCategoria = 'deporte';
    else if (categoriaActual === 'finanzas') nombreCategoria = 'finanzas';
    const fecha = new Date().toISOString().slice(0, 10);
    const nombreArchivo = `geo-cuba-${nombreCategoria}-${fecha}.png`;

    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    btn.innerHTML = '✅ ¡Descargado!';
    setTimeout(() => {
      btn.innerHTML = textoOriginal;
      btn.disabled = false;
    }, 1800);

  } catch (err) {
    console.error('Error descargando:', err);
    btn.innerHTML = textoOriginal;
    btn.disabled = false;
    alert('No se pudo descargar la imagen. Intenta de nuevo.');
  }
});

// --- 19. AJUSTE DEL MAPA EN RESIZE / ORIENTACIÓN ---
window.addEventListener('resize', () => {
  setTimeout(() => map.resize(), 200);
});

window.addEventListener('orientationchange', () => {
  setTimeout(() => map.resize(), 300);
});