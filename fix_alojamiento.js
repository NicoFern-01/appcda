const fs = require('fs');
const path = 'app.js';
let c = fs.readFileSync(path, 'utf8');
const log = [];

// 1) Comprension JPEG 0.8 -> 0.7
if (c.indexOf('calidad = 0.8)') !== -1) {
    c = c.replace('calidad = 0.8)', 'calidad = 0.7)');
    log.push('OK param compresion: 0.8 -> 0.7');
} else log.push('WARN: no encontro param compresion');

if (c.indexOf('comprime a JPEG calidad 0.8,') !== -1) {
    c = c.replace('comprime a JPEG calidad 0.8,', 'comprime a JPEG calidad 0.7,');
    log.push('OK comentario compresion: 0.8 -> 0.7');
} else log.push('WARN: no encontro comentario compresion');

// 3) Eliminacion de foto previa al reemplazar en edicion
const ancla = 'fotoUrl = await subirFotoAlojamiento(file, alojamiento.id);';
if (c.indexOf('fotoAnterior') === -1) {
    const inyeccion =
        "            const fotoAnterior = alojamiento.fotoUrl || '';\n" +
        "            if (fotoAnterior) {\n" +
        "                try {\n" +
        "                    await eliminarFotoAlojamiento(fotoAnterior);\n" +
        "                } catch (errFoto) {\n" +
        "                    console.warn('No se pudo eliminar la foto anterior:', errFoto);\n" +
        "                }\n" +
        "            }\n" +
        "            fotoUrl = await subirFotoAlojamiento(file, alojamiento.id);";
    const antes = c.length;
    c = c.replace(ancla, inyeccion);
    log.push(c.length !== antes ? 'OK eliminacion foto insertada' : 'WARN: ancla no coincidio');
} else {
    log.push('INFO: eliminacion foto ya estaba aplicada');
}

fs.writeFileSync(path, c);
fs.writeFileSync('fix_log.txt', log.join('\n'));
