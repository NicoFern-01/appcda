import { verificarPermiso } from '../utils/permisosUtil.js';
import persistenceService from './persistenceService.js';

const STORE_DESIGNACIONES = 'designacionesPersonal';
const STORE_CORREOS = 'listaCorreosDesignaciones';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const estado = {
  competencias: [],
  staff: [],
  circuitos: [],
  categorias: [],
  designaciones: [],
  correos: [],
  competenciaSolicitada: '',
  filtrosInicializados: false,
  listenersInstalados: false
};

function usuarioActual() {
  return typeof window !== 'undefined' ? window.currentUser : null;
}

function tienePermiso(accion) {
  return verificarPermiso(usuarioActual(), 'designaciones-personal', accion);
}

function notificar(mensaje, tipo = 'success') {
  if (typeof window !== 'undefined' && typeof window.mostrarToast === 'function') {
    window.mostrarToast(mensaje, tipo);
  } else if (tipo === 'error') {
    window.alert(mensaje);
  }
}

function obtenerRaiz() {
  return document.getElementById('view-designaciones-personal');
}

function idComoTexto(id) {
  return String(id ?? '');
}

function mesDeFecha(fecha) {
  const coincidencia = String(fecha || '').match(/^(\d{4})-(0[1-9]|1[0-2])/);
  if (coincidencia) return `${coincidencia[1]}-${coincidencia[2]}`;
  const fechaParseada = new Date(fecha);
  if (Number.isNaN(fechaParseada.getTime())) return '';
  return `${fechaParseada.getFullYear()}-${String(fechaParseada.getMonth() + 1).padStart(2, '0')}`;
}

function fechaVisual(fecha) {
  const mes = mesDeFecha(fecha);
  if (!mes) return 'Fecha sin definir';
  const [anio, numeroMes, dia] = String(fecha).slice(0, 10).split('-').map(Number);
  if (dia && anio && numeroMes) {
    return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
      .format(new Date(Date.UTC(anio, numeroMes - 1, dia, 12)));
  }
  const [anioMes, mesNumero] = mes.split('-').map(Number);
  return `${MESES[mesNumero - 1]} ${anioMes}`;
}

function crearElemento(tag, className, texto) {
  const elemento = document.createElement(tag);
  if (className) elemento.className = className;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

function crearBoton(etiqueta, accion, icono, clase = 'btn btn-secondary') {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = clase;
  boton.dataset.action = accion;
  const icon = document.createElement('i');
  icon.className = `fa-solid ${icono}`;
  icon.setAttribute('aria-hidden', 'true');
  boton.append(icon, document.createTextNode(` ${etiqueta}`));
  return boton;
}

function obtenerCompetencia(id) {
  return estado.competencias.find((competencia) => idComoTexto(competencia.id) === idComoTexto(id));
}

function obtenerStaff(id) {
  return estado.staff.find((persona) => idComoTexto(persona.id) === idComoTexto(id));
}

function obtenerDesignaciones(competenciaId) {
  return estado.designaciones.filter((designacion) =>
    idComoTexto(designacion.competenciaId) === idComoTexto(competenciaId)
  );
}

function establecerAccesos() {
  const raiz = obtenerRaiz();
  if (!raiz) return;
  const puedeGestionar = tienePermiso('crear') && tienePermiso('editar') && tienePermiso('eliminar');
  raiz.querySelectorAll('[data-write-only]').forEach((elemento) => {
    elemento.hidden = !puedeGestionar;
  });
}

function inicializarFiltros(raiz) {
  const filtroMes = raiz.querySelector('#designaciones-mes');
  const filtroCompetencia = raiz.querySelector('#designaciones-competencia');
  if (!estado.filtrosInicializados) {
    const parametros = new URLSearchParams(window.location.search);
    const mesSolicitado = parametros.get('mes') || '';
    const competenciaSolicitada = parametros.get('competenciaId') || '';
    estado.competenciaSolicitada = competenciaSolicitada;
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(mesSolicitado)) {
      filtroMes.value = mesSolicitado;
    } else if (competenciaSolicitada) {
      const competencia = obtenerCompetencia(competenciaSolicitada);
      if (competencia && mesDeFecha(competencia.fechaInicio)) {
        filtroMes.value = mesDeFecha(competencia.fechaInicio);
      }
    }
    estado.filtrosInicializados = true;
  }

  if (!filtroMes.value) {
    const hoy = new Date();
    filtroMes.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  }

  const filtroAnterior = estado.competenciaSolicitada || filtroCompetencia.value || 'todas';
  estado.competenciaSolicitada = '';
  filtroCompetencia.replaceChildren();
  const todas = crearElemento('option', '', 'Todas las competencias');
  todas.value = 'todas';
  filtroCompetencia.appendChild(todas);
  [...estado.competencias]
    .sort((a, b) => String(a.fechaInicio || '').localeCompare(String(b.fechaInicio || '')))
    .forEach((competencia) => {
      const opcion = crearElemento('option', '', `${competencia.nombre || 'Competencia'} · ${fechaVisual(competencia.fechaInicio)}`);
      opcion.value = idComoTexto(competencia.id);
      filtroCompetencia.appendChild(opcion);
    });

  if (filtroAnterior !== 'todas' &&
      !Array.from(filtroCompetencia.options).some((opcion) => opcion.value === filtroAnterior)) {
    const noEncontrada = crearElemento('option', '', 'Competencia del enlace no disponible');
    noEncontrada.value = filtroAnterior;
    filtroCompetencia.appendChild(noEncontrada);
  }
  filtroCompetencia.value = filtroAnterior;
}

function competenciasVisibles() {
  const raiz = obtenerRaiz();
  const mes = raiz.querySelector('#designaciones-mes').value;
  const competenciaId = raiz.querySelector('#designaciones-competencia').value;
  return [...estado.competencias]
    .filter((competencia) => !mes || mesDeFecha(competencia.fechaInicio) === mes)
    .filter((competencia) => competenciaId === 'todas' || idComoTexto(competencia.id) === competenciaId)
    .sort((a, b) => String(a.fechaInicio || '').localeCompare(String(b.fechaInicio || '')));
}

function nombreCircuito(competencia) {
  const circuito = estado.circuitos.find((item) => idComoTexto(item.id) === idComoTexto(competencia.circuitoId));
  return circuito ? [circuito.nombre, circuito.ubicacion].filter(Boolean).join(' · ') : '';
}

function nombresCategorias(competencia) {
  return (competencia.categoriasIds || [])
    .map((id) => estado.categorias.find((categoria) => idComoTexto(categoria.id) === idComoTexto(id))?.nombre)
    .filter(Boolean)
    .join(', ');
}

function renderizarDestinatarios(raiz) {
  const lista = raiz.querySelector('#designaciones-email-list');
  lista.replaceChildren();
  if (estado.correos.length === 0) {
    lista.appendChild(crearElemento('li', 'designaciones-email-empty', 'Todavía no hay destinatarios agregados.'));
    return;
  }

  estado.correos.forEach((correo) => {
    const item = crearElemento('li', 'designaciones-email-item');
    const descripcion = crearElemento('span', 'designaciones-email-text');
    descripcion.textContent = correo.etiqueta
      ? `${correo.etiqueta} · ${correo.email}`
      : correo.email;
    const quitar = crearBoton('Quitar', 'remove-email', 'fa-trash', 'btn btn-secondary designaciones-remove-btn');
    quitar.dataset.id = idComoTexto(correo.id);
    quitar.setAttribute('aria-label', `Quitar destinatario ${correo.email}`);
    item.append(descripcion, quitar);
    lista.appendChild(item);
  });
}

function crearFormularioAsignacion(competencia) {
  const formulario = crearElemento('form', 'designaciones-assign-form');
  formulario.dataset.action = 'assign';
  formulario.dataset.competenciaId = idComoTexto(competencia.id);

  const grupoStaff = crearElemento('div', 'form-group');
  const labelStaff = crearElemento('label', '', 'Personal');
  const idSelect = `designaciones-staff-${idComoTexto(competencia.id)}`;
  labelStaff.htmlFor = idSelect;
  const selector = document.createElement('select');
  selector.id = idSelect;
  selector.required = true;
  selector.setAttribute('aria-label', 'Seleccionar personal para asignar');
  const indicacion = crearElemento('option', '', 'Seleccionar personal...');
  indicacion.value = '';
  selector.appendChild(indicacion);
  estado.staff
    .filter((persona) => persona.activo !== false)
    .sort((a, b) => `${a.apellido || ''} ${a.nombre || ''}`.localeCompare(`${b.apellido || ''} ${b.nombre || ''}`))
    .forEach((persona) => {
      const rol = persona.funcion || persona.rol || persona.especialidad;
      const texto = `${persona.nombre || ''} ${persona.apellido || ''}${rol ? ` · ${rol}` : ''}`.trim();
      const opcion = crearElemento('option', '', texto);
      opcion.value = idComoTexto(persona.id);
      selector.appendChild(opcion);
    });
  grupoStaff.append(labelStaff, selector);

  const grupoFuncion = crearElemento('div', 'form-group');
  const labelFuncion = crearElemento('label', '', 'Función en la competencia (opcional)');
  const idFuncion = `designaciones-funcion-${idComoTexto(competencia.id)}`;
  labelFuncion.htmlFor = idFuncion;
  const funcion = document.createElement('input');
  funcion.id = idFuncion;
  funcion.type = 'text';
  funcion.maxLength = 120;
  funcion.autocomplete = 'off';
  grupoFuncion.append(labelFuncion, funcion);

  const asignar = crearElemento('button', 'btn designaciones-assign-btn', '+ Asignar');
  asignar.type = 'submit';
  formulario.append(grupoStaff, grupoFuncion, asignar);
  return formulario;
}

function crearTarjetaCompetencia(competencia) {
  const tarjeta = crearElemento('article', 'designacion-card');
  const cabecera = crearElemento('div', 'designacion-card-header');
  const textoCabecera = crearElemento('div', 'designacion-card-title');
  textoCabecera.append(
    crearElemento('h2', '', competencia.nombre || 'Competencia sin nombre'),
    crearElemento('p', 'designacion-date', fechaVisual(competencia.fechaInicio))
  );
  const accionesMail = crearElemento('div', 'designacion-card-actions');
  if (tienePermiso('crear')) {
    accionesMail.append(
      crearBoton('Enviar por Mail', 'mail-competition', 'fa-envelope'),
      crearBoton('Copiar Resumen y Link', 'copy-competition', 'fa-copy')
    );
    accionesMail.querySelectorAll('button').forEach((boton) => {
      boton.dataset.competenciaId = idComoTexto(competencia.id);
    });
  }
  cabecera.append(textoCabecera, accionesMail);

  const metadatos = [nombreCircuito(competencia), nombresCategorias(competencia)].filter(Boolean);
  const meta = crearElemento('p', 'designacion-meta', metadatos.join(' · ') || 'Sin circuito o categoría informados');
  const lista = crearElemento('ul', 'designacion-staff-list');
  const asignaciones = obtenerDesignaciones(competencia.id);
  if (asignaciones.length === 0) {
    lista.appendChild(crearElemento('li', 'designacion-staff-empty', 'Sin personal asignado.'));
  } else {
    asignaciones.forEach((asignacion) => {
      const persona = obtenerStaff(asignacion.staffId);
      const fila = crearElemento('li', 'designacion-staff-row');
      const nombre = persona
        ? `${persona.nombre || ''} ${persona.apellido || ''}`.trim()
        : 'Personal no disponible';
      const detalle = crearElemento('span', 'designacion-staff-name', nombre);
      const funcion = asignacion.funcion || persona?.funcion || persona?.rol || persona?.especialidad;
      if (funcion) detalle.appendChild(crearElemento('small', 'designacion-staff-function', funcion));
      fila.appendChild(detalle);
      if (tienePermiso('eliminar')) {
        const quitar = crearBoton('Quitar', 'remove-assignment', 'fa-user-minus', 'btn btn-secondary designaciones-remove-btn');
        quitar.dataset.id = idComoTexto(asignacion.id);
        quitar.setAttribute('aria-label', `Quitar a ${nombre} de ${competencia.nombre || 'la competencia'}`);
        fila.appendChild(quitar);
      }
      lista.appendChild(fila);
    });
  }

  tarjeta.append(cabecera, meta, crearElemento('h3', 'designacion-staff-heading', `Personal asignado (${asignaciones.length})`), lista);
  if (tienePermiso('crear')) tarjeta.appendChild(crearFormularioAsignacion(competencia));
  return tarjeta;
}

function renderizarVista() {
  const raiz = obtenerRaiz();
  if (!raiz) return;
  establecerAccesos();
  inicializarFiltros(raiz);
  const lista = raiz.querySelector('#designaciones-list');
  lista.replaceChildren();

  if (tienePermiso('crear')) renderizarDestinatarios(raiz);

  const competencias = competenciasVisibles();
  if (competencias.length === 0) {
    lista.appendChild(crearElemento('p', 'designaciones-empty', 'No hay competencias para los filtros seleccionados.'));
    return;
  }
  competencias.forEach((competencia) => lista.appendChild(crearTarjetaCompetencia(competencia)));
}

function competenciaDeAccion(id) {
  const competencia = obtenerCompetencia(id);
  if (!competencia) throw new Error('No se encontró la competencia seleccionada.');
  return competencia;
}

async function copiarAlPortapapeles(texto) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(texto);
    return;
  }
  const campoTemporal = document.createElement('textarea');
  campoTemporal.value = texto;
  campoTemporal.setAttribute('readonly', '');
  campoTemporal.style.position = 'fixed';
  campoTemporal.style.opacity = '0';
  document.body.appendChild(campoTemporal);
  let copiado = false;
  try {
    campoTemporal.select();
    copiado = document.execCommand('copy');
  } finally {
    campoTemporal.remove();
  }
  if (!copiado) throw new Error('No se pudo copiar el resumen al portapapeles.');
}

function enlaceDirecto(filtro, valor) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('vista', 'designaciones-personal');
  url.searchParams.set(filtro, valor);
  return url.toString();
}

function detalleCompetencia(competencia) {
  const asignaciones = obtenerDesignaciones(competencia.id);
  const personal = asignaciones.length
    ? asignaciones.map((asignacion) => {
      const persona = obtenerStaff(asignacion.staffId);
      const nombre = persona
        ? `${persona.nombre || ''} ${persona.apellido || ''}`.trim()
        : 'Personal no disponible';
      const funcion = asignacion.funcion || persona?.funcion || persona?.rol || persona?.especialidad;
      return `- ${nombre}${funcion ? ` — ${funcion}` : ''}`;
    }).join('\n')
    : '- Sin personal asignado';
  const metadata = [nombreCircuito(competencia), nombresCategorias(competencia)].filter(Boolean).join(' · ');
  return [
    competencia.nombre || 'Competencia sin nombre',
    `Fecha: ${fechaVisual(competencia.fechaInicio)}`,
    metadata ? `Circuito / categoría: ${metadata}` : '',
    'Personal designado:',
    personal
  ].filter(Boolean).join('\n');
}

function armarResumenIndividual(competencia) {
  const link = enlaceDirecto('competenciaId', idComoTexto(competencia.id));
  return `${detalleCompetencia(competencia)}\n\nAcceso a las designaciones:\n${link}`;
}

function destinatariosBcc() {
  return estado.correos.map((correo) => correo.email).filter(Boolean).join(',');
}

function abrirMail(asunto, cuerpo) {
  const parametros = new URLSearchParams();
  parametros.set('bcc', destinatariosBcc());
  parametros.set('subject', asunto);
  parametros.set('body', cuerpo);
  window.location.href = `mailto:?${parametros.toString()}`;
}

function fechaParaAsunto(fecha) {
  const mes = mesDeFecha(fecha);
  if (!mes) return 'fecha sin definir';
  const [anio, numeroMes] = mes.split('-').map(Number);
  return `${MESES[numeroMes - 1]} ${anio}`;
}

async function enviarMailCompetencia(id) {
  if (!tienePermiso('crear')) throw new Error('No tenés permisos para enviar notificaciones.');
  if (estado.correos.length === 0) throw new Error('Agregá al menos un destinatario en la Lista de Correo.');
  const competencia = competenciaDeAccion(id);
  abrirMail(
    `Designación de Personal - ${competencia.nombre || 'Competencia'} (${fechaVisual(competencia.fechaInicio)})`,
    armarResumenIndividual(competencia)
  );
}

async function copiarResumenCompetencia(id) {
  if (!tienePermiso('crear')) throw new Error('No tenés permisos para copiar notificaciones.');
  await copiarAlPortapapeles(armarResumenIndividual(competenciaDeAccion(id)));
  notificar('Copiado al portapapeles');
}

function competenciasDelMes() {
  const mes = obtenerRaiz().querySelector('#designaciones-mes').value;
  return estado.competencias
    .filter((competencia) => mesDeFecha(competencia.fechaInicio) === mes)
    .sort((a, b) => String(a.fechaInicio || '').localeCompare(String(b.fechaInicio || '')));
}

function armarResumenMensual() {
  const mes = obtenerRaiz().querySelector('#designaciones-mes').value;
  const link = enlaceDirecto('mes', mes);
  const detalle = competenciasDelMes();
  const tituloMes = /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)
    ? fechaParaAsunto(`${mes}-01`)
    : 'mes seleccionado';
  const resumen = detalle.length
    ? detalle.map(detalleCompetencia).join('\n\n--------------------\n\n')
    : 'No hay competencias registradas para este mes.';
  return {
    asunto: `Designación de Personal - Copia Mensual (${tituloMes})`,
    link,
    texto: `Designación de Personal — ${tituloMes}\n\n${resumen}\n\nAcceso a todas las designaciones del mes:\n${link}`
  };
}

async function copiarResumenMensual() {
  if (!tienePermiso('crear')) throw new Error('No tenés permisos para copiar notificaciones.');
  await copiarAlPortapapeles(armarResumenMensual().texto);
  notificar('Copiado al portapapeles');
}

async function enviarMailMensual() {
  if (!tienePermiso('crear')) throw new Error('No tenés permisos para enviar notificaciones.');
  if (estado.correos.length === 0) throw new Error('Agregá al menos un destinatario en la Lista de Correo.');
  const resumen = armarResumenMensual();
  if (resumen.texto.length > 1800) {
    await copiarAlPortapapeles(resumen.texto);
    abrirMail(resumen.asunto, `El detalle mensual se copió al portapapeles.\n\nAcceso al mes:\n${resumen.link}`);
    notificar('El detalle mensual se copió al portapapeles, pegalo en el cuerpo del correo (Ctrl+V)');
    return;
  }
  abrirMail(resumen.asunto, resumen.texto);
}

async function asignarPersonal(formulario) {
  if (!tienePermiso('crear')) throw new Error('No tenés permisos para asignar personal.');
  const competenciaId = formulario.dataset.competenciaId;
  const competencia = competenciaDeAccion(competenciaId);
  const staffId = formulario.querySelector('select').value;
  const persona = obtenerStaff(staffId);
  const funcion = formulario.querySelector('input').value.trim();
  if (!persona) throw new Error('Seleccioná una persona válida del staff.');
  if (funcion.length > 120) throw new Error('La función no puede superar los 120 caracteres.');
  if (obtenerDesignaciones(competencia.id).some((asignacion) => idComoTexto(asignacion.staffId) === idComoTexto(persona.id))) {
    throw new Error(`${persona.nombre || 'La persona'} ya está asignada a esta competencia.`);
  }

  const registro = {
    competenciaId: idComoTexto(competencia.id),
    staffId: idComoTexto(persona.id),
    funcion
  };
  const id = await persistenceService.guardar(STORE_DESIGNACIONES, registro);
  if (id === null || id === undefined) throw new Error('No se pudo guardar la designación.');
  if (!estado.designaciones.some((item) => idComoTexto(item.id) === idComoTexto(registro.id))) {
    estado.designaciones.push(registro);
  }
  renderizarVista();
}

async function quitarAsignacion(id) {
  if (!tienePermiso('eliminar')) throw new Error('No tenés permisos para quitar asignaciones.');
  const asignacion = estado.designaciones.find((item) => idComoTexto(item.id) === idComoTexto(id));
  if (!asignacion) throw new Error('No se encontró la asignación seleccionada.');
  await persistenceService.eliminar(STORE_DESIGNACIONES, asignacion.id);
  estado.designaciones = estado.designaciones.filter((item) => idComoTexto(item.id) !== idComoTexto(id));
  renderizarVista();
}

async function agregarDestinatario(formulario) {
  if (!tienePermiso('crear')) throw new Error('No tenés permisos para administrar la lista de correo.');
  const campoEmail = formulario.querySelector('#designaciones-email');
  const campoEtiqueta = formulario.querySelector('#designaciones-email-label');
  const email = campoEmail.value.trim().toLowerCase();
  const etiqueta = campoEtiqueta.value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Ingresá una dirección de email válida.');
  }
  if (etiqueta.length > 80) throw new Error('La etiqueta no puede superar los 80 caracteres.');
  if (estado.correos.some((correo) => String(correo.email || '').toLowerCase() === email)) {
    throw new Error('Ese email ya está en la lista de destinatarios.');
  }
  const registro = { email, etiqueta };
  const id = await persistenceService.guardar(STORE_CORREOS, registro);
  if (id === null || id === undefined) throw new Error('No se pudo guardar el destinatario.');
  if (!estado.correos.some((item) => idComoTexto(item.id) === idComoTexto(registro.id))) {
    estado.correos.push(registro);
  }
  formulario.reset();
  renderizarDestinatarios(obtenerRaiz());
}

async function quitarDestinatario(id) {
  if (!tienePermiso('eliminar')) throw new Error('No tenés permisos para administrar la lista de correo.');
  const correo = estado.correos.find((item) => idComoTexto(item.id) === idComoTexto(id));
  if (!correo) throw new Error('No se encontró el destinatario seleccionado.');
  await persistenceService.eliminar(STORE_CORREOS, correo.id);
  estado.correos = estado.correos.filter((item) => idComoTexto(item.id) !== idComoTexto(id));
  renderizarDestinatarios(obtenerRaiz());
}

async function manejarAccion(evento) {
  const raiz = obtenerRaiz();
  const boton = evento.target.closest('[data-action]');
  if (!boton || !raiz.contains(boton)) return;
  try {
    switch (boton.dataset.action) {
      case 'mail-competition':
        await enviarMailCompetencia(boton.dataset.competenciaId);
        break;
      case 'copy-competition':
        await copiarResumenCompetencia(boton.dataset.competenciaId);
        break;
      case 'remove-assignment':
        await quitarAsignacion(boton.dataset.id);
        break;
      case 'remove-email':
        await quitarDestinatario(boton.dataset.id);
        break;
      case 'mail-month':
        await enviarMailMensual();
        break;
      case 'copy-month':
        await copiarResumenMensual();
        break;
      default:
        break;
    }
  } catch (error) {
    notificar(error.message || 'No se pudo completar la acción.', 'error');
  }
}

function instalarListeners(raiz) {
  if (estado.listenersInstalados) return;
  estado.listenersInstalados = true;
  raiz.addEventListener('click', manejarAccion);
  raiz.addEventListener('change', (evento) => {
    if (evento.target.matches('#designaciones-mes, #designaciones-competencia')) renderizarVista();
  });
  raiz.addEventListener('submit', async (evento) => {
    const formulario = evento.target;
    if (!formulario.matches('#designaciones-email-form, .designaciones-assign-form')) return;
    evento.preventDefault();
    const botonSubmit = formulario.querySelector('button[type="submit"]');
    if (botonSubmit?.disabled) return;
    if (botonSubmit) botonSubmit.disabled = true;
    try {
      if (formulario.matches('#designaciones-email-form')) await agregarDestinatario(formulario);
      else await asignarPersonal(formulario);
    } catch (error) {
      notificar(error.message || 'No se pudo guardar la información.', 'error');
    } finally {
      if (botonSubmit?.isConnected) botonSubmit.disabled = false;
    }
  });
}

export async function cargar() {
  const raiz = obtenerRaiz();
  if (!raiz) return;
  if (!tienePermiso('ver')) {
    notificar('No tenés permisos para acceder a las designaciones.', 'error');
    return;
  }

  instalarListeners(raiz);
  const puedeGestionar = tienePermiso('crear');
  try {
    const [competencias, staff, designaciones, circuitos, categorias, correos] = await Promise.all([
      persistenceService.getTodos('competencias'),
      persistenceService.getTodos('staff'),
      persistenceService.getTodos(STORE_DESIGNACIONES),
      persistenceService.getTodos('circuitos'),
      persistenceService.getTodos('categorias'),
      puedeGestionar ? persistenceService.getTodos(STORE_CORREOS) : Promise.resolve([])
    ]);
    estado.competencias = competencias;
    estado.staff = staff;
    estado.designaciones = designaciones;
    estado.circuitos = circuitos;
    estado.categorias = categorias;
    estado.correos = correos;
    renderizarVista();
  } catch (error) {
    notificar(`No se pudieron cargar las designaciones: ${error.message || error}`, 'error');
    const lista = raiz.querySelector('#designaciones-list');
    lista.replaceChildren(crearElemento('p', 'designaciones-empty', 'No se pudieron cargar las designaciones.'));
  }
}

export const designacionesPersonalService = { cargar };
export default designacionesPersonalService;
