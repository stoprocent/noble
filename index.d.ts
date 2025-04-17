/// <reference types="node" />
declare module '@stoprocent/bluetooth-hci-socket' {
    type DriverType = any; // Fallback type
    interface BindParams {
        [key: string]: any;
    }
}

declare module '@stoprocent/noble' {
    import { EventEmitter } from 'events';

    export type AdapterState = 'poweredOn' | 'poweredOff' | 'unauthorized' | 'unsupported' | 'unknown' | 'resetting';
    
    export type PeripheralState = 'error' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

    export type PeripheralAddressType = 'public' | 'random';

    export type PeripheralIdOrAddress = string;

    export interface ConnectOptions {
        addressType?: PeripheralAddressType;
        minInterval?: number;
        maxInterval?: number;
        latency?: number;
        timeout?: number;
    }

    export class Noble extends EventEmitter {
    
        constructor(bindings: any);
        
        readonly state: State;
        readonly address: string;
    
        waitForPoweredOnAsync(timeout?: number): Promise<void>;
        startScanningAsync(serviceUUIDs?: string[], allowDuplicates?: boolean): Promise<void>;
        stopScanningAsync(): Promise<void>;
        connectAsync(idOrAddress: PeripheralIdOrAddress, options?: ConnectOptions): Promise<Peripheral>;
    
        startScanning(serviceUUIDs?: string[], allowDuplicates?: boolean, callback?: (error?: Error) => void): void;
        stopScanning(callback?: () => void): void;
        connect(idOrAddress: PeripheralIdOrAddress, options?: ConnectOptions, callback?: (error: Error | undefined, peripheral: Peripheral) => void): void;
        cancelConnect(idOrAddress: PeripheralIdOrAddress, options?: object): void;
        reset(): void;
        stop(): void;
        setAddress(address: string): void;
    
        on(event: "stateChange", listener: (state: State) => void): this;
        on(event: "scanStart", listener: () => void): this;
        on(event: "scanStop", listener: () => void): this;
        on(event: "discover", listener: (peripheral: Peripheral) => void): this;
        on(event: string, listener: Function): this;
    
        once(event: "stateChange", listener: (state: State) => void): this;
        once(event: "scanStart", listener: () => void): this;
        once(event: "scanStop", listener: () => void): this;
        once(event: "discover", listener: (peripheral: Peripheral) => void): this;
        once(event: string, listener: Function): this;
    
        removeListener(event: "stateChange", listener: (state: State) => void): this;
        removeListener(event: "scanStart", listener: () => void): this;
        removeListener(event: "scanStop", listener: () => void): this;
        removeListener(event: "discover", listener: (peripheral: Peripheral) => void): this;
        removeListener(event: string, listener: Function): this;
    }

    export interface ServicesAndCharacteristics {
        services: Service[];
        characteristics: Characteristic[];
    }
    
    export interface PeripheralAdvertisement {
        localName: string;
        serviceData: Array<{
            uuid: string,
            data: Buffer
        }>;
        txPowerLevel: number;
        manufacturerData: Buffer;
        serviceUuids: string[];
        serviceSolicitationUuids: string[];
    }

    export class Peripheral extends EventEmitter {
        readonly id: string;
        readonly address: string;
        readonly addressType: PeripheralAddressType;
        readonly connectable: boolean;
        readonly advertisement: PeripheralAdvertisement;
        readonly rssi: number;
        readonly mtu: number | null;
        readonly services: Service[];
        readonly state: PeripheralState;

        /** @deprecated Use id instead */
        readonly uuid: string;
    
        connectAsync(): Promise<void>;
        disconnectAsync(): Promise<void>;
        updateRssiAsync(): Promise<number>;
        discoverServicesAsync(): Promise<Service[]>;
        discoverServicesAsync(serviceUUIDs: string[]): Promise<Service[]>;
        discoverAllServicesAndCharacteristicsAsync(): Promise<ServicesAndCharacteristics>;
        discoverSomeServicesAndCharacteristicsAsync(serviceUUIDs: string[], characteristicUUIDs: string[]): Promise<ServicesAndCharacteristics>;
        readHandleAsync(handle: number): Promise<Buffer>;
        writeHandleAsync(handle: number, data: Buffer, withoutResponse: boolean): Promise<void>;

        connect(callback?: (error: Error | undefined) => void): void;
        disconnect(callback?: () => void): void;
        updateRssi(callback?: (error: Error | undefined, rssi: number) => void): void;
        discoverServices(): void;
        discoverServices(serviceUUIDs: string[], callback?: (error: Error | undefined, services: Service[]) => void): void;
        discoverAllServicesAndCharacteristics(callback?: (error: Error | undefined, services: Service[], characteristics: Characteristic[]) => void): void;
        discoverSomeServicesAndCharacteristics(serviceUUIDs: string[], characteristicUUIDs: string[], callback?: (error: Error | undefined, services: Service[], characteristics: Characteristic[]) => void): void;        
        readHandle(handle: number, callback: (error: Error | undefined, data: Buffer) => void): void;
        writeHandle(handle: number, data: Buffer, withoutResponse: boolean, callback: (error: Error | undefined) => void): void;
        
        cancelConnect(options?: object): void;
        toString(): string;
    
        on(event: "connect", listener: (error: Error | undefined) => void): this;
        on(event: "disconnect", listener: (error: Error | undefined) => void): this;
        on(event: "rssiUpdate", listener: (rssi: number) => void): this;
        on(event: "servicesDiscover", listener: (services: Service[]) => void): this;
        on(event: "mtu", listener: (mtu: number) => void): this;
        on(event: string, listener: Function): this;
    
        once(event: "connect", listener: (error: Error | undefined) => void): this;
        once(event: "disconnect", listener: (error: Error | undefined) => void): this;
        once(event: "rssiUpdate", listener: (rssi: number) => void): this;
        once(event: "servicesDiscover", listener: (services: Service[]) => void): this;
        once(event: string, listener: Function): this;
    }

    export class Service extends EventEmitter {

        readonly uuid: string;
        readonly name: string;
        readonly type: string;
        readonly includedServiceUuids: string[];
        readonly characteristics: Characteristic[];
    
        discoverIncludedServicesAsync(): Promise<string[]>;
        discoverIncludedServicesAsync(serviceUUIDs: string[]): Promise<string[]>;
        discoverCharacteristicsAsync(): Promise<Characteristic[]>;
        discoverCharacteristicsAsync(characteristicUUIDs: string[]): Promise<Characteristic[]>;
        
        discoverIncludedServices(): void;
        discoverIncludedServices(serviceUUIDs: string[], callback?: (error: Error | undefined, includedServiceUuids: string[]) => void): void;
        discoverCharacteristics(): void;
        discoverCharacteristics(characteristicUUIDs: string[], callback?: (error: Error | undefined, characteristics: Characteristic[]) => void): void;
        
        toString(): string;
    
        on(event: "includedServicesDiscover", listener: (includedServiceUuids: string[]) => void): this;
        on(event: "characteristicsDiscover", listener: (characteristics: Characteristic[]) => void): this;
        on(event: string, listener: Function): this;
    
        once(event: "includedServicesDiscover", listener: (includedServiceUuids: string[]) => void): this;
        once(event: "characteristicsDiscover", listener: (characteristics: Characteristic[]) => void): this;
        once(event: string, listener: Function): this;
    }
    
    export class Characteristic extends EventEmitter {
        
        readonly uuid: string;
        readonly name: string;
        readonly type: string;
        readonly properties: string[];
        readonly descriptors: Descriptor[];
    
        readAsync(): Promise<Buffer>;
        writeAsync(data: Buffer, withoutResponse: boolean): Promise<void>;
        broadcastAsync(broadcast: boolean): Promise<void>;
        notifyAsync(notify: boolean): Promise<void>;
        discoverDescriptorsAsync(): Promise<Descriptor[]>;
        subscribeAsync(): Promise<void>;
        unsubscribeAsync(): Promise<void>;
        
        read(callback?: (error: Error | undefined, data: Buffer) => void): void;
        write(data: Buffer, withoutResponse: boolean, callback?: (error: Error | undefined) => void): void;
        broadcast(broadcast: boolean, callback?: (error: Error | undefined) => void): void;
        notify(notify: boolean, callback?: (error: Error | undefined) => void): void;
        discoverDescriptors(callback?: (error: Error | undefined, descriptors: Descriptor[]) => void): void;
        subscribe(callback?: (error: Error | undefined) => void): void;
        unsubscribe(callback?: (error: Error | undefined) => void): void;
        
        toString(): string;
        
        on(event: "read", listener: (data: Buffer, isNotification: boolean) => void): this;
        on(event: "write", withoutResponse: boolean, listener: (error: Error | undefined) => void): this;
        on(event: "broadcast", listener: (state: string) => void): this;
        on(event: "notify", listener: (state: string) => void): this;
        on(event: "data", listener: (data: Buffer, isNotification: boolean) => void): this;
        on(event: "descriptorsDiscover", listener: (descriptors: Descriptor[]) => void): this;
        on(event: string, listener: Function): this;
    
        once(event: "read", listener: (data: Buffer, isNotification: boolean) => void): this;
        once(event: "write", withoutResponse: boolean, listener: (error: Error | undefined) => void): this;
        once(event: "broadcast", listener: (state: string) => void): this;
        once(event: "notify", listener: (state: string) => void): this;
        once(event: "data", listener: (data: Buffer, isNotification: boolean) => void): this;
        once(event: "descriptorsDiscover", listener: (descriptors: Descriptor[]) => void): this;
        once(event: string, listener: Function): this;
    }
    
    export class Descriptor extends EventEmitter {
        readonly uuid: string;
        readonly name: string;
        readonly type: string;
    
        readValueAsync(): Promise<Buffer>;
        writeValueAsync(data: Buffer): Promise<void>;

        readValue(callback?: (error: Error | undefined, data: Buffer) => void): void;
        writeValue(data: Buffer, callback?: (error: Error | undefined) => void): void;
        
        toString(): string;
    
        on(event: "valueRead", listener: (error: Error | undefined, data: Buffer) => void): this;
        on(event: "valueWrite", listener: (error: Error | undefined) => void): this;
        on(event: string, listener: Function): this;
    
        once(event: "valueRead", listener: (error: Error | undefined, data: Buffer) => void): this;
        once(event: "valueWrite", listener: (error: Error | undefined) => void): this;
        once(event: string, listener: Function): this;
    }

    /*
    * Binding
    */

    export type BindingType = 'default' | 'hci' | 'mac' | 'win';

    export interface BaseBindingsOptions {}

    export interface HciBindingsOptions extends BaseBindingsOptions {
        hciDriver?: import('@stoprocent/bluetooth-hci-socket').DriverType;
        bindParams?: import('@stoprocent/bluetooth-hci-socket').BindParams;
    }

    export interface MacBindingsOptions extends BaseBindingsOptions {}
    export interface WinBindingsOptions extends BaseBindingsOptions {}

    export type WithBindingsOptions = HciBindingsOptions | MacBindingsOptions | WinBindingsOptions;

    export function withBindings(
        bindingType?: BindingType, 
        options?: WithBindingsOptions
    ): Noble;

    // Define a default export
    const NobleDefault: Noble;
    export default NobleDefault;
}








