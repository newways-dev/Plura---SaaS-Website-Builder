'use server'

import { clerkClient, currentUser } from '@clerk/nextjs'
import { redirect } from 'next/navigation'
import { db } from './db'
import {
  Agency,
  Lane,
  Plan,
  Prisma,
  Role,
  SubAccount,
  Ticket,
  User,
} from '@prisma/client'
import * as z from 'zod'
import { v4 } from 'uuid'
import { CreateFunnelFormSchema, CreateMediaType } from './types'

export const getAuthUserDetails = async () => {
  const user = await currentUser()
  if (!user) {
    return
  }

  const userData = await db.user.findUnique({
    where: {
      email: user.emailAddresses[0].emailAddress,
    },
    include: {
      Agency: {
        include: {
          SidebarOption: true,
          SubAccount: {
            include: {
              SidebarOption: true,
            },
          },
        },
      },
      Permissions: true,
    },
  })

  return userData
}

export const saveActivityLogsNotification = async ({
  agencyId,
  description,
  subaccountId,
}: {
  agencyId?: string
  description: string
  subaccountId?: string
}) => {
  'use server'
  const authUser = await currentUser()
  let userData
  if (!authUser) {
    const response = await db.user.findFirst({
      where: {
        Agency: {
          SubAccount: {
            some: { id: subaccountId },
          },
        },
      },
    })
    if (response) {
      userData = response
    }
  } else {
    userData = await db.user.findUnique({
      where: { email: authUser?.emailAddresses[0].emailAddress },
    })
  }

  if (!userData) {
    console.log('Could not find a user')
    return
  }

  let foundAgencyId = agencyId
  if (!foundAgencyId) {
    if (!subaccountId) {
      throw new Error(
        'You need to provide atleast an agency Id or subaccount Id'
      )
    }
    const response = await db.subAccount.findUnique({
      where: { id: subaccountId },
    })
    if (response) foundAgencyId = response.agencyId
  }
  if (subaccountId) {
    await db.notification.create({
      data: {
        notification: `${userData.name} | ${description}`,
        User: {
          connect: {
            id: userData.id,
          },
        },
        Agency: {
          connect: {
            id: foundAgencyId,
          },
        },
        SubAccount: {
          connect: { id: subaccountId },
        },
      },
    })
  } else {
    await db.notification.create({
      data: {
        notification: `${userData.name} | ${description}`,
        User: {
          connect: {
            id: userData.id,
          },
        },
        Agency: {
          connect: {
            id: foundAgencyId,
          },
        },
      },
    })
  }
}

export const createTeamUser = async (agencyId: string, user: User) => {
  if (user.role === 'AGENCY_OWNER') return null
  const response = await db.user.create({ data: { ...user } })
  return response
}

export const verifyAndAcceptInvitation = async () => {
  const user = await currentUser()
  if (!user) return redirect('/sign-in')

  const invitationExists = await db.invitation.findUnique({
    where: {
      email: user.emailAddresses[0].emailAddress,
      status: 'PENDING',
    },
  })

  if (invitationExists) {
    const userDetails = await createTeamUser(invitationExists.agencyId, {
      email: invitationExists.email,
      agencyId: invitationExists.agencyId,
      avatarUrl: user.imageUrl,
      id: user.id,
      name: `${user.firstName} ${user.lastName}`,
      role: invitationExists.role,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await saveActivityLogsNotification({
      agencyId: invitationExists?.agencyId,
      description: `Joined`,
      subaccountId: undefined,
    })

    if (userDetails) {
      try {
        await clerkClient.users.updateUserMetadata(user.id, {
          privateMetadata: {
            role: userDetails.role || 'SUBACCOUNT_USER',
          },
        })
      } catch (err) {
        console.error('Failed to update Clerk user metadata (invitation):', err)
        // Do not block flow if Clerk metadata update fails in dev
      }

      await db.invitation.delete({
        where: { email: userDetails.email },
      })

      return userDetails.agencyId
    } else return null
  } else {
    const agency = await db.user.findUnique({
      where: {
        email: user.emailAddresses[0].emailAddress,
      },
    })
    return agency ? agency.agencyId : null
  }
}

export const updateAgencyDetails = async (
  agencyId: string,
  agencyDetails: Partial<Agency>
) => {
  const response = await db.agency.update({
    where: { id: agencyId },
    data: { ...agencyDetails },
  })
  return response
}

export const deleteAgency = async (agencyId: string) => {
  const response = await db.agency.delete({ where: { id: agencyId } })
  return response
}

export const initUser = async (newUser: Partial<User>) => {
  const user = await currentUser()
  if (!user) return

  const userData = await db.user.upsert({
    where: {
      email: user.emailAddresses[0].emailAddress,
    },
    update: newUser,
    create: {
      id: user.id,
      avatarUrl: user.imageUrl,
      email: user.emailAddresses[0].emailAddress,
      name: `${user.firstName} ${user.lastName}`,
      role: newUser.role || 'SUBACCOUNT_USER',
    },
  })

  try {
    await clerkClient.users.updateUserMetadata(user.id, {
      privateMetadata: {
        role: newUser.role || 'SUBACCOUNT_USER',
      },
    })
  } catch (err) {
    console.error('Failed to update Clerk user metadata (initUser):', err)
  }

  return userData
}

const UpsertAgencySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  agencyLogo: z.string().trim().min(1),
  companyEmail: z.string().trim().min(1),
  companyPhone: z.string().trim().min(1),
  whiteLabel: z.boolean(),
  address: z.string().trim().min(1),
  city: z.string().trim().min(1),
  zipCode: z.string().trim().min(1),
  state: z.string().trim().min(1),
  country: z.string().trim().min(1),
  connectAccountId: z.string().optional().default(''),
  goal: z.number().int().optional().default(5),
})

export type UpsertAgencyInput = z.infer<typeof UpsertAgencySchema>

export const upsertAgency = async (input: UpsertAgencyInput, price?: Plan) => {
  const agency = UpsertAgencySchema.parse(input)
  const agencyDetails = await db.agency.upsert({
    where: {
      id: agency.id,
    },
    update: {
      name: agency.name,
      agencyLogo: agency.agencyLogo,
      companyEmail: agency.companyEmail,
      companyPhone: agency.companyPhone,
      whiteLabel: agency.whiteLabel,
      address: agency.address,
      city: agency.city,
      zipCode: agency.zipCode,
      state: agency.state,
      country: agency.country,
      connectAccountId: agency.connectAccountId,
      goal: agency.goal,
    },
    create: {
      id: agency.id,
      name: agency.name,
      agencyLogo: agency.agencyLogo,
      companyEmail: agency.companyEmail,
      companyPhone: agency.companyPhone,
      whiteLabel: agency.whiteLabel,
      address: agency.address,
      city: agency.city,
      zipCode: agency.zipCode,
      state: agency.state,
      country: agency.country,
      connectAccountId: agency.connectAccountId,
      goal: agency.goal,
      users: {
        connect: { email: agency.companyEmail },
      },
      SidebarOption: {
        create: [
          {
            name: 'Dashboard',
            icon: 'category',
            link: `/agency/${agency.id}`,
          },
          {
            name: 'Launchpad',
            icon: 'clipboardIcon',
            link: `/agency/${agency.id}/launchpad`,
          },
          {
            name: 'Billing',
            icon: 'payment',
            link: `/agency/${agency.id}/billing`,
          },
          {
            name: 'Settings',
            icon: 'settings',
            link: `/agency/${agency.id}/settings`,
          },
          {
            name: 'Sub Accounts',
            icon: 'person',
            link: `/agency/${agency.id}/all-subaccounts`,
          },
          {
            name: 'Team',
            icon: 'shield',
            link: `/agency/${agency.id}/team`,
          },
        ],
      },
    },
  })

  return agencyDetails
}

export const getNotificationAndUser = async (agencyId: string) => {
  try {
    const response = await db.notification.findMany({
      where: { agencyId },
      include: { User: true },
      orderBy: {
        createdAt: 'desc',
      },
    })
    return response
  } catch (error) {
    console.log(error)
  }
}

const UpsertSubAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  subAccountLogo: z.string().trim().min(1),
  companyEmail: z.string().trim().min(1),
  companyPhone: z.string().trim().min(1),
  address: z.string().trim().min(1),
  city: z.string().trim().min(1),
  zipCode: z.string().trim().min(1),
  state: z.string().trim().min(1),
  country: z.string().trim().min(1),
  agencyId: z.string().min(1),
  connectAccountId: z.string().optional().default(''),
  goal: z.number().int().optional().default(5),
})

export type UpsertSubAccountInput = z.infer<typeof UpsertSubAccountSchema>

export const upsertSubAccount = async (input: UpsertSubAccountInput) => {
  const subAccount = UpsertSubAccountSchema.parse(input)
  if (!subAccount.companyEmail) return null
  const agencyOwner = await db.user.findFirst({
    where: {
      Agency: {
        id: subAccount.agencyId,
      },
      role: 'AGENCY_OWNER',
    },
  })

  if (!agencyOwner) return console.error('Erorr could not create subaccount')

  const permissionId = v4()
  const response = await db.subAccount.upsert({
    where: { id: subAccount.id },
    update: {
      name: subAccount.name,
      subAccountLogo: subAccount.subAccountLogo,
      companyEmail: subAccount.companyEmail,
      companyPhone: subAccount.companyPhone,
      address: subAccount.address,
      city: subAccount.city,
      zipCode: subAccount.zipCode,
      state: subAccount.state,
      country: subAccount.country,
      connectAccountId: subAccount.connectAccountId,
      goal: subAccount.goal,
      agencyId: subAccount.agencyId,
    },
    create: {
      id: subAccount.id,
      name: subAccount.name,
      subAccountLogo: subAccount.subAccountLogo,
      companyEmail: subAccount.companyEmail,
      companyPhone: subAccount.companyPhone,
      address: subAccount.address,
      city: subAccount.city,
      zipCode: subAccount.zipCode,
      state: subAccount.state,
      country: subAccount.country,
      connectAccountId: subAccount.connectAccountId,
      goal: subAccount.goal,
      Agency: {
        connect: {
          id: subAccount.agencyId,
        },
      },
      Permissions: {
        create: {
          access: true,
          email: agencyOwner.email,
          id: permissionId,
        },
        connect: {
          subAccountId: subAccount.id,
          id: permissionId,
        },
      },
      Pipeline: {
        create: { name: 'Lead Cycle' },
      },
      SidebarOption: {
        create: [
          {
            name: 'Launchpad',
            icon: 'clipboardIcon',
            link: `/subaccount/${subAccount.id}/launchpad`,
          },
          {
            name: 'Settings',
            icon: 'settings',
            link: `/subaccount/${subAccount.id}/settings`,
          },
          {
            name: 'Funnels',
            icon: 'pipelines',
            link: `/subaccount/${subAccount.id}/funnels`,
          },
          {
            name: 'Media',
            icon: 'database',
            link: `/subaccount/${subAccount.id}/media`,
          },
          {
            name: 'Automations',
            icon: 'chip',
            link: `/subaccount/${subAccount.id}/automations`,
          },
          {
            name: 'Pipelines',
            icon: 'flag',
            link: `/subaccount/${subAccount.id}/pipelines`,
          },
          {
            name: 'Contacts',
            icon: 'person',
            link: `/subaccount/${subAccount.id}/contacts`,
          },
          {
            name: 'Dashboard',
            icon: 'category',
            link: `/subaccount/${subAccount.id}`,
          },
        ],
      },
    },
  })
  return response
}

export const getUserPermissions = async (userId: string) => {
  const response = await db.user.findUnique({
    where: { id: userId },
    select: { Permissions: { include: { SubAccount: true } } },
  })

  return response
}

export const updateUser = async (user: Partial<User>) => {
  const response = await db.user.update({
    where: { email: user.email },
    data: { ...user },
  })

  await clerkClient.users.updateUserMetadata(response.id, {
    privateMetadata: {
      role: user.role || 'SUBACCOUNT_USER',
    },
  })

  return response
}

export const changeUserPermissions = async (
  permissionId: string | undefined,
  userEmail: string,
  subAccountId: string,
  permission: boolean
) => {
  try {
    const response = await db.permissions.upsert({
      where: { id: permissionId },
      update: { access: permission },
      create: {
        access: permission,
        email: userEmail,
        subAccountId: subAccountId,
      },
    })
    return response
  } catch (error) {
    console.log('Could not change persmission', error)
  }
}

export const getSubaccountDetails = async (subaccountId: string) => {
  const response = await db.subAccount.findUnique({
    where: {
      id: subaccountId,
    },
  })
  return response
}

export const deleteSubAccount = async (subaccountId: string) => {
  const response = await db.subAccount.delete({
    where: {
      id: subaccountId,
    },
  })
  return response
}

export const deleteUser = async (userId: string) => {
  await clerkClient.users.updateUserMetadata(userId, {
    privateMetadata: {
      role: undefined,
    },
  })
  const deletedUser = await db.user.delete({ where: { id: userId } })

  return deletedUser
}

export const getUser = async (id: string) => {
  const user = await db.user.findUnique({
    where: {
      id,
    },
  })

  return user
}

export const sendInvitation = async (
  role: Role,
  email: string,
  agencyId: string
) => {
  const SendInvitationSchema = z.object({
    role: z.nativeEnum(Role),
    email: z.string().email(),
    agencyId: z.string().min(1),
  })

  const parsed = SendInvitationSchema.parse({ role, email, agencyId })

  const resposne = await db.invitation.create({
    data: {
      email: parsed.email,
      agencyId: parsed.agencyId,
      role: parsed.role,
    },
  })

  try {
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: parsed.email,
      redirectUrl: process.env.NEXT_PUBLIC_URL,
      publicMetadata: {
        throughInvitation: true,
        role: parsed.role,
      },
    })
  } catch (error) {
    console.log(error)
    throw error
  }

  return resposne
}

export const getMedia = async (subaccountId: string) => {
  const mediafiles = await db.subAccount.findUnique({
    where: {
      id: subaccountId,
    },
    include: { Media: true },
  })
  return mediafiles
}

export const createMedia = async (
  subaccountId: string,
  mediaFile: CreateMediaType
) => {
  'use server'
  const response = await db.media.create({
    data: {
      link: mediaFile.link,
      name: mediaFile.name,
      subAccountId: subaccountId,
    },
  })

  return response
}

export const deleteMedia = async (mediaId: string) => {
  'use server'
  const response = await db.media.delete({
    where: {
      id: mediaId,
    },
  })
  return response
}

export const getPipelineDetails = async (pipelineId: string) => {
  const response = await db.pipeline.findUnique({
    where: {
      id: pipelineId,
    },
  })
  return response
}

export const getLanesWithTicketAndTags = async (pipelineId: string) => {
  const response = await db.lane.findMany({
    where: {
      pipelineId,
    },
    orderBy: { order: 'asc' },
    include: {
      Tickets: {
        orderBy: {
          order: 'asc',
        },
        include: {
          Tags: true,
          Assigned: true,
          Customer: true,
        },
      },
    },
  })
  return response
}

export const upsertFunnel = async (
  subaccountId: string,
  funnel: z.infer<typeof CreateFunnelFormSchema> & { liveProducts: string },
  funnelId: string
) => {
  const response = await db.funnel.upsert({
    where: { id: funnelId },
    update: funnel,
    create: {
      ...funnel,
      id: funnelId || v4(),
      subAccountId: subaccountId,
    },
  })

  return response
}

export const upsertPipeline = async (
  pipeline: Prisma.PipelineUncheckedCreateWithoutLaneInput
) => {
  const response = await db.pipeline.upsert({
    where: { id: pipeline.id || v4() },
    update: pipeline,
    create: pipeline,
  })

  return response
}

export const deletePipeline = async (pipelineId: string) => {
  const response = await db.pipeline.delete({
    where: { id: pipelineId },
  })
  return response
}

export const updateLanesOrder = async (lanes: Lane[]) => {
  try {
    const updateTrans = lanes.map((lane) =>
      db.lane.update({
        where: {
          id: lane.id,
        },
        data: {
          order: lane.order,
        },
      })
    )

    await db.$transaction(updateTrans)
    console.log('Done reordered')
  } catch (error) {
    console.log(error, 'ERROR UPDATE LANES ORDER')
  }
}

export const updateTicketsOrder = async (tickets: Ticket[]) => {
  try {
    const updateTrans = tickets.map((ticket) =>
      db.ticket.update({
        where: {
          id: ticket.id,
        },
        data: {
          order: ticket.order,
          laneId: ticket.laneId,
        },
      })
    )

    await db.$transaction(updateTrans)
    console.log('Done reordered')
  } catch (error) {
    console.log(error, 'ERROR UPDATE TICKET ORDER')
  }
}
