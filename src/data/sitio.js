export const sitio = {
  nombre: 'Firehouse Cheerleading All Stars',
  nombreCorto: 'Firehouse Cheer',
  url: 'https://firehousecheer.cl',
  telefono: '+56986114663',
  instagram: 'https://www.instagram.com/firehouse.cheer/',
  calle: 'Santa Corina 197',
  comuna: 'La Cisterna',
  ciudad: 'Santiago',
  metro: 'Lo Ovalle',
  cercanas: 'San Miguel, El Bosque y Pedro Aguirre Cerda',
  lat: -33.514675,
  lng: -70.660583,
  areaServida: ['La Cisterna', 'San Miguel', 'El Bosque', 'Pedro Aguirre Cerda', 'Lo Espejo', 'La Granja', 'Santiago'],
  mapa: 'https://maps.google.com/maps?q=Santa%20Corina%20197%2C%20La%20Cisterna%2C%20Santiago&z=16&output=embed',
  comoLlegar: 'https://www.google.com/maps/dir/?api=1&destination=Santa+Corina+197%2C+La+Cisterna%2C+Santiago',
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
