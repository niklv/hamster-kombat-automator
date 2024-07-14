import { LAUNCH_MODE_ENUM } from '~/enums'
import { select } from '@inquirer/prompts'

export const launchPrompt = async () =>
  select({
    message: 'Select an action',
    choices: [
      {
        name: 'Add new account',
        value: LAUNCH_MODE_ENUM.add_account,
      },
      { name: 'Run automator', value: LAUNCH_MODE_ENUM.automator },
    ],
  })
