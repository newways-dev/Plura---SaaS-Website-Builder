import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { dark } from '@clerk/themes'
import './globals.css'
import { ThemeProvider } from '@/providers/theme-provider'

const inter = DM_Sans({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Plura',
  description: 'All in one agency solution',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider appearance={{ baseTheme: dark }}>
      <html suppressHydrationWarning lang="en">
        <body className={inter.className}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
