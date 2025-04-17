import { withBindings } from "@stoprocent/noble";

const address = process.argv[2]?.toLowerCase() || '11:22:44:55:99:77';
const noble = withBindings('default');

await noble.waitForPoweredOnAsync();
console.log('noble started');

for await (const peripheral of noble.discoverAsync()) {
    if ([peripheral.id, peripheral.address].includes(address) === false) {
        continue;
    }

    await noble.stopScanningAsync();
    console.log('peripheral', peripheral.address || peripheral.id);
    console.log('discovered', peripheral.advertisement);    

    await peripheral.connectAsync();
    console.log('connected');

    const { services } = await peripheral.discoverAllServicesAndCharacteristicsAsync();

    for (const service of services) {
        console.log('Service\x1b[34m', service.uuid, '\x1b[0m');
        for (const characteristic of service.characteristics) {
            
            console.log('  | Characteristic\x1b[32m', characteristic.uuid, '\x1b[0m');
            console.log('  |  | Type:', characteristic.type);
            console.log('  |  | Properties:', characteristic.properties);

            if (characteristic.properties.includes('read')) {
                let value = await characteristic.readAsync();
                console.log(`  |  | Value: 0x${value.toString('hex')}`);
            }
            
            const descriptors = await characteristic.discoverDescriptorsAsync();
            for (const descriptor of descriptors) {
                console.log('  |  | Descriptor\x1b[33m', descriptor.uuid, '\x1b[0m');
                const value = await descriptor.readValueAsync();
                console.log(`  |  |  | Value: 0x${value.toString('hex')}`);
            }
        }
    }

    await peripheral.disconnectAsync();
    console.log('disconnected');

    break;
}

noble.stop();
console.log('noble stopped');
