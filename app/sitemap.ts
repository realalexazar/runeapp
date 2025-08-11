import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://your-domain.com/',
      changeFrequency: 'weekly',
      priority: 1
    },
    {
      url: 'https://your-domain.com/auth',
      changeFrequency: 'yearly',
      priority: 0.3
    }
  ]
}



