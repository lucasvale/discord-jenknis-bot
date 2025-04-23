// discord-jenkins-bot.js
require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const Jenkins = require('jenkins');
const username = process.env.JENKINS_USERNAME;
const token = process.env.JENKINS_API_TOKEN;
const url = process.env.JENKINS_URL;

// Initialize Jenkins client with the new keyword
const jenkins = new Jenkins({
  baseUrl: `https://${username}:${token}@${url}`,
});



// Map of project names to Jenkins job names
// You can expand this with your actual project mapping
const projectMap = {
  'frontend': 'build-frontend',
  'backend': 'build-backend',
  'api': 'build-api',
  'mobile': 'build-mobile',
  'ms-b2b': 'ms-b2b-dev',
  // Add more projects as needed
};

async function getDefaultParametersValues(projectName) {
  const jenkinsJobName = projectMap[projectName];

  const params = {};
  if (!jenkinsJobName) {
    return null;
  }
  const data = await jenkins.job.get(jenkinsJobName);
  if (!data || !data.property) {
    return null;
  }
  const paramDef = data.property.find(prop => 
    prop._class === 'hudson.model.ParametersDefinitionProperty'
  );
  if (!paramDef || !paramDef.parameterDefinitions) {
    return null;
  }
  paramDef.parameterDefinitions.forEach(param => {
    params[param.name] = param.defaultParameterValue ? param.defaultParameterValue.value : null;
  });
  return params;
}

async function getJobParameters(projectName) {

  if (!projectName) {
    return null;
  }

  const jenkinsJobName = projectMap[projectName];

  if (!jenkinsJobName) {
    return null;
  }

  const data = await jenkins.job.get(jenkinsJobName);

  try {
    const parameters = [];
        
        // Check if job has parameters
        if (data && data.property) {
          // Find the ParametersDefinitionProperty
          const paramDef = data.property.find(prop => 
            prop._class === 'hudson.model.ParametersDefinitionProperty'
          );
          
          if (paramDef && paramDef.parameterDefinitions) {
            // Extract parameter details
            paramDef.parameterDefinitions.forEach(param => {
              parameters.push({
                name: param.name,
                type: param._class,
                defaultValue: param.defaultParameterValue ? param.defaultParameterValue.value : null,
                description: param.description || 'No description',
                choices: param.choices || []
              });
            });
          }
        }
        return parameters;
    } catch (error) {
      console.error('Error getting job parameters:', error);
      return null;
    }
}

// Function to build a project
async function buildProject(projectName, callback) {

  const jenkinsJobName = projectMap[projectName];
  
  if (!jenkinsJobName) {
    return callback(`Project "${projectName}" not found. Available projects: ${Object.keys(projectMap).join(', ')}`);
  }

  const defaultParameters = await getDefaultParametersValues(projectName);

  if (!defaultParameters) {
    return callback(`Failed to get default parameters for project "${projectName}"`);
  }

  try {
    console.log(`Starting build for project: ${projectName}`);
    
    // Trigger Jenkins job
    const result = await jenkins.job.build(jenkinsJobName, { parameters: defaultParameters });
    console.log('Jenkins build triggered');
    if (result) {
      console.log(`Build for ${projectName} queued with ID: ${result}. Waiting for build to start...`);
      // Wait for queue item to convert to a build
      const checkBuildStatus = setInterval(async () => {
        try {
          const item = await jenkins.queue.item(result);
          
          if (!item) {
            clearInterval(checkBuildStatus);
            return callback(`Error checking queue status: ${result}`);
          }
          
          if (item.executable) {
            clearInterval(checkBuildStatus);
            const buildNumber = item.executable.number;
            console.log(`Build #${buildNumber} for ${projectName} started! You can check the progress at: ${process.env.JENKINS_URL}/job/${jenkinsJobName}/${buildNumber}/console`);
            // Monitor build status
            monitorBuildStatus(jenkinsJobName, buildNumber, projectName, callback);
          }
        } catch (error) {
          clearInterval(checkBuildStatus);
          return callback(`Error checking build status: ${error.message}`);
        }
      }, 1000); // Check every 1 second
    }
  } catch (error) {
    console.error('Error:', error.response.body);
    callback(`An error occurred: ${error.message}`);
  }
}

function monitorBuildStatus(jenkinsJobName, buildNumber, projectName, callback) {
  const checkInterval = setInterval( async() => {
    try {
      const data = await jenkins.build.get(jenkinsJobName, buildNumber);
      if (!data) {
        clearInterval(checkInterval);
        return callback(`Error monitoring build status: ${buildNumber}`);
      }
      
      if (!data.building) {
        clearInterval(checkInterval);
        const result = data.result;
        console.log(`Build #${buildNumber} for ${projectName} finished with status: ${result}`);
        callback(null, { buildNumber, result, projectName });
      }
    } catch (error) {
      clearInterval(checkInterval);
      return callback(`Error monitoring build status: ${error.message}`);
    }
  }, 1000); // Check every 1 second
}

async function checkJenkinsAuth() {
  try {
    const res = await jenkins.info();
    console.log('Jenkins authentication check:', res );
    return true;
  } catch (error) {
    console.error('Error checking Jenkins authentication:', error);
    return false;
  }
}

// CLI entrypoint
async function runCLI() {

  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'build') {
    const projectName = args[1]?.toLowerCase();
    
    if (!projectName) {
      console.error('Please specify a project name. Example: node discord-jenkins-bot.js build frontend');
      process.exit(1);
    }
    
    await buildProject(projectName, (error, result) => {
      if (error) {
        console.error(error);
        process.exit(1);
      } else {
        console.log(`✅ Build #${result.buildNumber} for ${result.projectName} completed with status: ${result.result}`);
        process.exit(0);
      }
    });
  } else if (command === 'list') {
    console.log('Available projects:');
    Object.keys(projectMap).forEach(project => {
      console.log(`- ${project} (Jenkins job: ${projectMap[project]})`);
    });
    process.exit(0);
  } else if (command === 'params') {
    const projectName = args[1]?.toLowerCase();
    
    if (!projectName) {
      console.error('Please specify a project name. Example: node discord-jenkins-bot.js parameters frontend');
      process.exit(1);
    }
    
    const parameters = await getJobParameters(projectName);
    if (!parameters) {
      console.error('Failed to get parameters for project', projectName);
      process.exit(1);
    }
    console.log('Parameters:', parameters);
    process.exit(0);
  } else {
    console.log(`
CLI Commands:
  build [project-name] - Build a specific project
  list                - List available projects
    `);
    process.exit(0);
  }
}

// Discord bot setup
function startDiscordBot() {
  // Create a new Discord client
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  // Command prefix for the bot
  const prefix = '!build';

  // When the client is ready, run this code
  client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}!`);
  });

  // Listen for messages
  client.on(Events.MessageCreate, async message => {
    // Ignore messages from bots or messages that don't start with the prefix
    if (message.author.bot || !message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === '') {
      const projectName = args[0]?.toLowerCase();
      
      if (!projectName) {
        return message.reply('Please specify a project name. Example: `!build frontend`');
      }

      await message.reply(`Starting build for project: ${projectName}`);
      
      await buildProject(projectName, async (error, result) => {
        if (error) {
          await message.reply(error);
        } else {
          let statusEmoji;
          
          switch(result.result) {
            case 'SUCCESS':
              statusEmoji = '✅';
              break;
            case 'FAILURE':
              statusEmoji = '❌';
              break;
            case 'UNSTABLE':
              statusEmoji = '⚠️';
              break;
            default:
              statusEmoji = '❓';
          }
          
          await message.reply(`${statusEmoji} Build #${result.buildNumber} for ${result.projectName} finished with status: ${result.result}`);
        }
      });
    } else if (command === 'help') {
      message.reply(`
**Jenkins Bot Commands**
- \`!build [project-name]\` - Build a specific project
- \`!build help\` - Show this help message
- \`!build list\` - List available projects

**Available projects:** ${Object.keys(projectMap).join(', ')}
      `);
    } else if (command === 'list') {
      message.reply(`**Available projects:** ${Object.keys(projectMap).join(', ')}`);
    }
  });

  // Login to Discord with your client's token
  client.login(process.env.DISCORD_TOKEN);
}

// Determine if running in CLI mode or Discord bot mode
if (require.main === module) {
  // If this script is called directly
  if (process.argv.length > 2) {
    // CLI mode with arguments
    runCLI();
  } else {
    // No arguments, start Discord bot
    startDiscordBot();
  }
} else {
  // This script is imported/required by another script
  module.exports = {
    buildProject,
    projectMap
  };
}