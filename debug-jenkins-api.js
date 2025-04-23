// debug-jenkins-api.js
require('dotenv').config();
const Jenkins = require('jenkins');
const username = process.env.JENKINS_USERNAME;
const token = process.env.JENKINS_API_TOKEN;
const url = process.env.JENKINS_URL;

// Initialize Jenkins client
const jenkins = new Jenkins({
    baseUrl: `https://${username}:${token}@${url}`,
  });
  

// Function to inspect Jenkins job details
async function inspectJob(jobName) {
  try {
    console.log(`Inspecting job: ${jobName}`);
    
    const jobInfo = await jenkins.job.get(jobName);
    
    console.log('Job Class:', jobInfo._class);
    console.log('Is Buildable:', jobInfo.buildable);
    
    // Check if job is parameterized
    const isParameterized = jobInfo.property && jobInfo.property.some(
      prop => prop._class === 'hudson.model.ParametersDefinitionProperty'
    );
    
    console.log('Is Parameterized:', isParameterized);

    let paramProp = null;
    
    if (isParameterized) {
      paramProp = jobInfo.property.find(
        prop => prop._class === 'hudson.model.ParametersDefinitionProperty'
      );
      
      console.log('\nParameters:', paramProp);
      paramProp.parameterDefinitions.forEach(param => {
        console.log(`- ${param.name} (${param._class.split('.').pop()})`);
        console.log(`  Description: ${param.description || 'No description'}`);
        console.log(`  Default value: ${param.defaultParameterValue ? param.defaultParameterValue.value : 'None'}`);
        if (param.choices) {
          console.log(`  Choices: ${param.choices.join(', ')}`);
        }
        console.log('');
      });
    }
    
    // Get build info for last build if available
    if (jobInfo.lastBuild) {
      console.log(`\nLast Build #${jobInfo.lastBuild.number}`);
      try {
        const buildInfo = await jenkins.build.get(jobName, jobInfo.lastBuild.number);
        
        console.log('  Result:', buildInfo.result || 'In progress');
        console.log('  URL:', buildInfo.url);
        
        if (buildInfo.actions) {
          const paramAction = buildInfo.actions.find(
            action => action._class === 'hudson.model.ParametersAction'
          );
          
          if (paramAction && paramAction.parameters) {
            console.log('\n  Parameters used:');
            paramAction.parameters.forEach(param => {
              console.log(`  - ${param.name}: ${param.value}`);
            });
          }
        }
      } catch (error) {
        console.error('Error getting build info:', error.message);
      }
    }
    
    return { 
      jobName, 
      isParameterized,
      parameters: isParameterized ? paramProp.parameterDefinitions.map(p => ({
          name: p.name,
          type: p._class,
          defaultValue: p.defaultParameterValue ? p.defaultParameterValue.value : null
        })) : []
    };
    
  } catch (error) {
    console.error('Error inspecting job:', error.message);
    throw error;
  }
}

// Function to test build with different parameter approaches
async function testBuild(jobName, jobInfo) {
  console.log(`\n=== Testing build for ${jobName} ===`);
  
  // Test build with empty parameters if parameterized
  if (jobInfo.isParameterized) {
    console.log('\nTrying build with empty parameters object...');
    try {
      const queueId = await jenkins.job.build(jobName, { parameters: {} });
      console.log('Success! Build queued with ID:', queueId);
    } catch (error) {
      console.log('Failed with empty parameters:', error.message);
      
      // Try with default parameters
      console.log('\nTrying build with default parameters...');
      try {
        const parameters = {};
        jobInfo.parameters.forEach(param => {
          if (param.defaultValue !== null) {
            parameters[param.name] = param.defaultValue;
          }
        });
        
        console.log('Using parameters:', parameters);
        
        const queueId = await jenkins.job.build(jobName, { parameters });
        console.log('Success! Build queued with ID:', queueId);
      } catch (error) {
        console.log('Failed with default parameters:', error.message);
        
        // Try with token (if needed)
        console.log('\nTrying build with token auth...');
        try {
          const queueId = await jenkins.job.build(jobName, {
            token: process.env.JENKINS_BUILD_TOKEN || 'DEFAULT_TOKEN',
            parameters: {}
          });
          console.log('Success! Build queued with ID:', queueId);
        } catch (error) {
          console.log('Failed with token:', error.message);
          console.log('\nAll build attempts failed.');
        }
      }
    }
  } else {
    // Non-parameterized job
    console.log('\nTrying to build non-parameterized job...');
    try {
      const queueId = await jenkins.job.build(jobName, {});
      console.log('Success! Build queued with ID:', queueId);
    } catch (error) {
      console.log('Failed to build non-parameterized job:', error.message);
    }
  }
}

// Main function
async function main() {
  const jobName = process.argv[2];
  
  if (!jobName) {
    console.error('Please provide a job name: node debug-jenkins-api.js JOB_NAME');
    process.exit(1);
  }
  
  try {
    const jobInfo = await inspectJob(jobName);

    console.log('Job details:', jobInfo);
    
    // If requested, test build approaches
    if (process.argv.includes('--test-build')) {
      console.log('\n=== Testing build approaches ===');
      await testBuild(jobName, jobInfo);
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the main function
main();