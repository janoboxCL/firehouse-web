export const sitio = {
  nombre: 'Firehouse Cheerleading All Stars',
  nombreCorto: 'Firehouse Cheer',
  url: 'https://firehousecheer.cl',
  telefono: '+56986114663',
  instagram: 'https://www.instagram.com/firehouse.cheer/',
  comuna: 'San Miguel',
  ciudad: 'Santiago',
  edadMinima: 4,
  horarios: [
    { dia: 'Viernes', hora: '18:00 – 20:00', clase: 'Cheer Class' },
    { dia: 'Sábado',  hora: '16:00 – 18:00', clase: 'Gimnasia' },
  ],
};

// Un solo lugar donde viven los mensajes prellenados.
// Cambiar el texto acá lo cambia en todo el sitio.
const mensajes = {
  hero:      'Hola, quiero agendar una clase de prueba gratis.',
  equipos:   'Hola, quiero saber en qué equipo entrenaría mi hijo o hija según su edad.',
  anio:      'Hola, quiero saber en qué está el equipo ahora mismo.',
  precios:   'Hola, quiero información para sumarme a Firehouse.',
  dosAlumnos:'Hola, quiero consultar por el valor para dos alumnos.',
  contacto:  'Hola, quiero hacer una consulta sobre Firehouse.',
};

export function whatsapp(clave = 'hero') {
  const texto = mensajes[clave] ?? mensajes.hero;
  return `https://wa.me/${sitio.telefono.replace('+', '')}?text=${encodeURIComponent(texto)}`;
}
