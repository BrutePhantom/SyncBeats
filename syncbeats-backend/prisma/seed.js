const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const initialSongs = [
  {
    title: 'SoundHelix Song 1',
    artist: 'T. Schürger',
    duration: 372.0,
    fileUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop'
  },
  {
    title: 'SoundHelix Song 2',
    artist: 'T. Schürger',
    duration: 423.0,
    fileUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop'
  },
  {
    title: 'SoundHelix Song 3',
    artist: 'T. Schürger',
    duration: 346.0,
    fileUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop'
  },
  {
    title: 'SoundHelix Song 8',
    artist: 'T. Schürger',
    duration: 325.0,
    fileUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=300&h=300&fit=crop'
  }
];

async function seed() {
  console.log('Seeding songs into database...');
  for (const song of initialSongs) {
    const existing = await prisma.song.findFirst({
      where: { title: song.title, artist: song.artist }
    });

    if (!existing) {
      await prisma.song.create({ data: song });
      console.log(`Created song: ${song.title}`);
    } else {
      console.log(`Song already exists: ${song.title}`);
    }
  }
  console.log('Seeding complete.');
}

seed()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

