import { Sidebar } from '@/components/shell/Sidebar'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-warm-white">
      <Sidebar />
      <div className="flex flex-col flex-1 h-screen overflow-hidden">
        {children}
      </div>
    </div>
  )
}
