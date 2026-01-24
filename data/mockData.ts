import { Template } from '../types';

const categories = ['Cosmetic', 'Food', 'Electronic', 'Fashion', 'Furniture'];
const tags = ['Minimal', 'Luxury', 'Nature', 'Dark', 'Bright', 'Studio'];

export const mockTemplates: Template[] = Array.from({ length: 50 }).map((_, i) => {
  const isPro = i % 3 === 0;
  const width = 800;
  const height = i % 2 === 0 ? 1000 : 800; // Mix of ratios
  return {
    id: `tpl_${i + 1}`,
    name: `Studio Scene ${i + 1}`,
    imageUrl: `https://picsum.photos/${width}/${height}?random=${i + 100}`,
    category: categories[i % categories.length],
    tags: [tags[i % tags.length], tags[(i + 1) % tags.length]],
    isPro,
    width,
    height,
  };
});

export const MOCK_GENERATED_IMAGES = [
  'https://picsum.photos/800/800?random=1001',
  'https://picsum.photos/800/800?random=1002',
  'https://picsum.photos/800/800?random=1003',
  'https://picsum.photos/800/800?random=1004',
];
