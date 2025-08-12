import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { Inter, Playfair_Display } from 'next/font/google'
import { cn } from '@/lib/utils'

import Providers from '@/components/providers'
import Header from '@/components/header'
import Footer from '@/components/footer'

import './globals.css'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900'
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900'
})
const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif'
})

export const metadata: Metadata = {
  metadataBase: new URL('https://your-domain.com'),
  title: {
    default: 'Mortgage App',
    template: '%s | Mortgage App'
  },
  description: 'A modern B2C/B2B mortgage web application.',
  robots: 'index,follow',
  icons: { icon: '/favicon.ico' },
  openGraph: {
    title: 'Mortgage App',
    description: 'A modern B2C/B2B mortgage web application.',
    url: 'https://your-domain.com',
    siteName: 'Mortgage App',
    type: 'website'
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mortgage App',
    description: 'A modern B2C/B2B mortgage web application.'
  }
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang='en' className='scroll-smooth' suppressHydrationWarning>
      <body
        className={cn(
          'flex min-h-screen flex-col bg-[#0B0B0F]',
          geistSans.variable,
          geistMono.variable,
          inter.variable,
          playfair.variable
        )}
      >
        <Providers>
          <Header />
          <main className='grow'>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
