import { DisconnectedError } from '../../src/common/errors';
import { Characteristic } from '../../src/gatt/characteristic';
import { Service } from '../../src/gatt/service';
import { PeripheralSession } from '../../src/gatt/session';
import { Deferred, FakeBindings, createSession } from '../helpers/fake-bindings';

const ID = 'aabbccddeeff';

describe('Service', () => {
  let bindings: FakeBindings;
  let session: PeripheralSession;
  let service: Service;

  beforeEach(() => {
    ({ bindings, session } = createSession(ID));
    service = new Service(session, '180f');
  });

  describe('assigned numbers', () => {
    test('resolves name and type of a Bluetooth SIG service', () => {
      expect(service.uuid).toBe('180f');
      expect(service.name).toBe('Battery Service');
      expect(service.type).toBe('org.bluetooth.service.battery_service');
    });

    test('leaves name and type null for a vendor service', () => {
      const vendor = new Service(session, '6e400001b5a3f393e0a9e50e24dcca9e');

      expect(vendor.name).toBeNull();
      expect(vendor.type).toBeNull();
    });
  });

  test('has no discovery results before the first discovery', () => {
    expect(service.characteristics).toBeNull();
    expect(service.includedServiceUuids).toBeNull();
  });

  describe('discoverIncludedServices', () => {
    test('asks for all included services by default and remembers the result', async () => {
      bindings.discoverIncludedServices.mockResolvedValueOnce(['180a']);

      await expect(service.discoverIncludedServices()).resolves.toEqual(['180a']);

      expect(bindings.discoverIncludedServices).toHaveBeenCalledWith(ID, '180f', []);
      expect(service.includedServiceUuids).toEqual(['180a']);
    });

    test('forwards the filter', async () => {
      await service.discoverIncludedServices(['180a', '1800']);

      expect(bindings.discoverIncludedServices).toHaveBeenCalledWith(ID, '180f', ['180a', '1800']);
    });

    test('propagates a failure and keeps the previous result', async () => {
      bindings.discoverIncludedServices.mockResolvedValueOnce(['180a']);
      await service.discoverIncludedServices();
      bindings.discoverIncludedServices.mockRejectedValueOnce(new Error('gatt error'));

      await expect(service.discoverIncludedServices()).rejects.toThrow('gatt error');

      expect(service.includedServiceUuids).toEqual(['180a']);
    });

    test('rejects with DisconnectedError when the link drops mid-request', async () => {
      bindings.discoverIncludedServices.mockReturnValueOnce(new Deferred<string[]>().promise);

      const discovering = service.discoverIncludedServices();
      session.disconnected.emit('remote');

      await expect(discovering).rejects.toBeInstanceOf(DisconnectedError);
      await expect(discovering).rejects.toMatchObject({ reason: 'remote' });
      expect(service.includedServiceUuids).toBeNull();
    });
  });

  describe('discoverCharacteristics', () => {
    test('asks for all characteristics by default and builds Characteristic objects', async () => {
      bindings.discoverCharacteristics.mockResolvedValueOnce([
        { uuid: '2a19', properties: ['read', 'notify'] },
        { uuid: 'ff01', properties: ['write'] }
      ]);

      const characteristics = await service.discoverCharacteristics();

      expect(bindings.discoverCharacteristics).toHaveBeenCalledWith(ID, '180f', []);
      expect(characteristics).toHaveLength(2);
      expect(characteristics[0]).toBeInstanceOf(Characteristic);
      expect(characteristics.map(c => c.uuid)).toEqual(['2a19', 'ff01']);
      expect(characteristics[0].properties).toEqual(['read', 'notify']);
      expect(characteristics[0].name).toBe('Battery Level');
      expect(service.characteristics).toBe(characteristics);
    });

    test('forwards the filter', async () => {
      await service.discoverCharacteristics(['2a19']);

      expect(bindings.discoverCharacteristics).toHaveBeenCalledWith(ID, '180f', ['2a19']);
    });

    test('the characteristics address this service on the same session', async () => {
      bindings.discoverCharacteristics.mockResolvedValueOnce([{ uuid: '2a19', properties: ['read'] }]);
      const [characteristic] = await service.discoverCharacteristics();

      await characteristic.read();

      expect(bindings.read).toHaveBeenCalledWith(ID, '180f', '2a19');
    });

    test('rejects with DisconnectedError when the link drops mid-request', async () => {
      bindings.discoverCharacteristics.mockReturnValueOnce(new Deferred<any[]>().promise);

      const discovering = service.discoverCharacteristics();
      session.disconnected.emit(0x08);

      await expect(discovering).rejects.toBeInstanceOf(DisconnectedError);
      await expect(discovering).rejects.toMatchObject({ reason: 0x08 });
      expect(service.characteristics).toBeNull();
    });
  });

  describe('serialisation', () => {
    test('toJSON before discovery', () => {
      expect(service.toJSON()).toEqual({
        uuid: '180f',
        name: 'Battery Service',
        type: 'org.bluetooth.service.battery_service',
        includedServiceUuids: null
      });
    });

    test('toJSON carries the included services once discovered', async () => {
      bindings.discoverIncludedServices.mockResolvedValueOnce(['180a']);
      await service.discoverIncludedServices();

      expect(service.toJSON()).toMatchObject({ includedServiceUuids: ['180a'] });
    });

    test('toString is the JSON form', () => {
      expect(service.toString()).toBe(
        '{"uuid":"180f","name":"Battery Service","type":"org.bluetooth.service.battery_service","includedServiceUuids":null}');
    });
  });
});
