import Unauthorized from '@/components/unauthorized'
import InfoBar from '@/components/global/infobar'
import Sidebar from '@/components/sidebar'
import {
  getAuthUserDetails,
  getNotificationAndUser,
  verifyAndAcceptInvitation,
  getSubaccountDetails,
} from '@/lib/queries'
import { currentUser } from '@clerk/nextjs'
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'
import { ReactNode } from 'react'

type Props = {
  children: ReactNode
  params: { subaccountId: string }
}

const SubaccountLayout = async ({ children, params }: Props) => {
  let agencyId = await verifyAndAcceptInvitation()
  if (!agencyId) {
    const sub = await getSubaccountDetails(params.subaccountId)
    agencyId = sub?.agencyId || null
  }

  const user = await currentUser()
  if (!user) {
    return redirect('/')
  }

  let notifications: any = []

  const authDetails = await getAuthUserDetails()
  const effectiveRole =
    (user.privateMetadata.role as Role | undefined) || authDetails?.role
  if (!effectiveRole) {
    return <Unauthorized />
  }

  const isAgencyPrivileged =
    effectiveRole === 'AGENCY_ADMIN' || effectiveRole === 'AGENCY_OWNER'

  // Only enforce explicit subaccount permission for non-agency users
  if (!isAgencyPrivileged) {
    const allPermissions = await getAuthUserDetails()
    const hasPermission = allPermissions?.Permissions.find(
      (permissions) =>
        permissions.access && permissions.subAccountId === params.subaccountId
    )
    if (!hasPermission) {
      return <Unauthorized />
    }
  }

  // Load notifications if we have a valid agencyId; otherwise, continue without them
  if (agencyId) {
    const allNotifications = await getNotificationAndUser(agencyId)
    if (isAgencyPrivileged) {
      notifications = allNotifications
    } else {
      const filteredNotifications = allNotifications?.filter(
        (item) => item.subAccountId === params.subaccountId
      )
      if (filteredNotifications) notifications = filteredNotifications
    }
  }

  return (
    <div className="h-screen overflow-hidden">
      <Sidebar id={params.subaccountId} type="subaccount" />
      <div className="md:pl-[300px]">
        <InfoBar
          notifications={notifications}
          role={effectiveRole}
          subAccountId={params.subaccountId as string}
        />
        <div className="relative">{children}</div>
      </div>
    </div>
  )
}

export default SubaccountLayout
