const noble = require('../index');

async function main() {
  try {
    // Wait for the BLE adapter to be ready
    console.log('Waiting for powered on state');
    await noble.waitForPoweredOnAsync();
    console.log('Powered on');

    // First attempt - direct connection
    const uuid = '2561b846d6f83ee27580bca8ed6ec079'; // MacOS UUID
    console.log('Attempting direct connection to:', uuid);
    
    try {
      const peripheral = await noble.connectAsync(uuid);
      console.log('Direct connection successful to:', peripheral.id);
      await peripheral.disconnectAsync();
      console.log('Disconnected from direct connection');
    } catch (error) {
      console.log('Direct connection failed:', error.message);
    }

    // Wait before trying scan method
    console.log('Waiting 2 seconds before scan attempt...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Second attempt - scan and connect
    console.log('Starting scan for device');
    await noble.startScanningAsync();

    noble.on('discover', async (peripheral) => {
      if (peripheral.id === uuid) {
        console.log('Found device in scan:', peripheral.id);
        await noble.stopScanningAsync();
        
        try {
          await peripheral.connectAsync();
          console.log('Scan connection successful to:', peripheral.id);
          await peripheral.disconnectAsync();
          console.log('Disconnected from scan connection');
        } catch (error) {
          console.log('Scan connection failed:', error.message);
        }
      }
    });

  } catch (error) {
    console.error('Main error:', error);
  }
}

// Handle process termination
const cleanup = async () => {
  console.log('Caught interrupt signal');
  await noble.stopScanningAsync();
  process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGQUIT', cleanup);
process.on('SIGTERM', cleanup);

// Start the application
main().catch(console.error);
