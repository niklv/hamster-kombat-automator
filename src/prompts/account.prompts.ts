import { input, password, select } from '@inquirer/prompts'
import { PROXY_TEMPLATE } from '~/constants'

export const proxyPrompt = async () =>
  input({
    message: `Enter proxy [format: ${PROXY_TEMPLATE}] (press enter to skip): `,
  })

export const phonePrompt = async () =>
  input({
    message: 'Enter your phone number',
  })

export const passwordPrompt = async () =>
  password({
    message: 'Enter your password',
  })

export const codePrompt = async () =>
  password({
    message: 'Enter the code you received',
  })

export const accountNamePrompt = async (): Promise<string> => {
  const name = await input({
    message: 'Enter a client name',
  })

  if (!name) return accountNamePrompt()
  return name
}

export const accountActionPrompt = async (name: string): Promise<'delete' | 'new'> =>
  select({
    message: `Client ${name} already exists, choose action`,
    choices: [
      { name: 'Enter a different client name', value: 'new' },
      { name: 'Delete an existing client', value: 'delete' },
    ],
  })
