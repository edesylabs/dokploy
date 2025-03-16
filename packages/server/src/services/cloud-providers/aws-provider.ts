import { 
  CloudProviderService, 
  ServerProvisioningRequest, 
  ServerResource, 
  InstanceTypeInfo,
  RegionInfo
} from './types';
import AWS from 'aws-sdk';
import { nanoid } from 'nanoid';
import { execAsync } from '@dokploy/server/utils/process/execAsync';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * AWS Cloud Provider implementation
 */
export class AWSCloudProvider implements CloudProviderService {
  private ec2: AWS.EC2;
  private cloudwatch: AWS.CloudWatch;
  private credentials: AWS.Credentials;
  private region: string;
  private config: {
    id: string;
    name: string;
    credentials: Record<string, string>;
    region: string;
    defaultInstanceType?: string;
    tags?: Record<string, string>;
  };

  constructor(config: {
    id: string;
    name: string;
    credentials: Record<string, string>;
    region: string;
    defaultInstanceType?: string;
    tags?: Record<string, string>;
  }) {
    this.config = config;
    this.credentials = new AWS.Credentials({
      accessKeyId: config.credentials.accessKeyId,
      secretAccessKey: config.credentials.secretAccessKey,
    });
    this.region = config.region;
    this.ec2 = new AWS.EC2({ credentials: this.credentials, region: this.region });
    this.cloudwatch = new AWS.CloudWatch({ credentials: this.credentials, region: this.region });
  }

  /**
   * List available AWS regions
   */
  async listAvailableRegions(): Promise<RegionInfo[]> {
    try {
      const response = await this.ec2.describeRegions({}).promise();
      return (response.Regions || []).map(region => ({
        id: region.RegionName || '',
        name: region.RegionName || '',
        location: this.getRegionLocation(region.RegionName || ''),
        available: true
      }));
    } catch (error) {
      console.error('Error listing AWS regions:', error);
      throw error;
    }
  }

  /**
   * Get a human-readable location for an AWS region
   */
  private getRegionLocation(regionCode: string): string {
    const regionMap: Record<string, string> = {
      'us-east-1': 'US East (N. Virginia)',
      'us-east-2': 'US East (Ohio)',
      'us-west-1': 'US West (N. California)',
      'us-west-2': 'US West (Oregon)',
      'af-south-1': 'Africa (Cape Town)',
      'ap-east-1': 'Asia Pacific (Hong Kong)',
      'ap-south-1': 'Asia Pacific (Mumbai)',
      'ap-northeast-1': 'Asia Pacific (Tokyo)',
      'ap-northeast-2': 'Asia Pacific (Seoul)',
      'ap-northeast-3': 'Asia Pacific (Osaka)',
      'ap-southeast-1': 'Asia Pacific (Singapore)',
      'ap-southeast-2': 'Asia Pacific (Sydney)',
      'ca-central-1': 'Canada (Central)',
      'eu-central-1': 'Europe (Frankfurt)',
      'eu-west-1': 'Europe (Ireland)',
      'eu-west-2': 'Europe (London)',
      'eu-west-3': 'Europe (Paris)',
      'eu-north-1': 'Europe (Stockholm)',
      'eu-south-1': 'Europe (Milan)',
      'me-south-1': 'Middle East (Bahrain)',
      'sa-east-1': 'South America (São Paulo)'
    };

    return regionMap[regionCode] || regionCode;
  }

  /**
   * List available EC2 instance types in a region
   */
  async listAvailableInstanceTypes(region: string): Promise<InstanceTypeInfo[]> {
    try {
      // Use the specified region or default to the configured region
      const ec2 = region !== this.region
        ? new AWS.EC2({ credentials: this.credentials, region })
        : this.ec2;

      // Get available instance types
      const response = await ec2.describeInstanceTypes({}).promise();
      
      // Filter to common instance types to avoid overwhelming the user
      const commonTypes = ['t2.micro', 't2.small', 't2.medium', 't3.micro', 't3.small', 't3.medium', 
                          'm5.large', 'c5.large', 'r5.large'];
      
      return (response.InstanceTypes || [])
        .filter(type => commonTypes.includes(type.InstanceType || ''))
        .map(type => ({
          name: type.InstanceType || '',
          cpuCount: type.VCpuInfo?.DefaultVCpus || 0,
          memoryGb: ((type.MemoryInfo?.SizeInMiB || 0) / 1024),
          storageGb: 8, // Default EBS size
          hourlyPrice: this.getEstimatedHourlyPrice(type.InstanceType || ''),
          description: `${type.InstanceType} (${type.VCpuInfo?.DefaultVCpus} vCPUs, ${((type.MemoryInfo?.SizeInMiB || 0) / 1024).toFixed(1)} GB RAM)`
        }));
    } catch (error) {
      console.error('Error listing AWS instance types:', error);
      throw error;
    }
  }

  /**
   * Get an estimated hourly price for an instance type
   * Note: These are rough estimates and should be replaced with actual pricing API calls
   */
  private getEstimatedHourlyPrice(instanceType: string): number {
    const priceMap: Record<string, number> = {
      't2.micro': 0.0116,
      't2.small': 0.023,
      't2.medium': 0.0464,
      't3.micro': 0.0104,
      't3.small': 0.0208,
      't3.medium': 0.0416,
      'm5.large': 0.096,
      'c5.large': 0.085,
      'r5.large': 0.126
    };

    return priceMap[instanceType] || 0.05; // Default fallback price
  }

  /**
   * Provision a new EC2 instance
   */
  async provisionServer(request: ServerProvisioningRequest): Promise<ServerResource> {
    try {
      // Use default instance type if not specified
      const instanceType = request.instanceType || this.config.defaultInstanceType || 't3.micro';
      
      // Create a unique name for the instance
      const instanceName = request.name;
      const instanceId = nanoid();
      
      // Combine tags from request and config
      const tags = {
        ...this.config.tags,
        ...request.tags,
        Name: instanceName,
        ManagedBy: 'dokploy',
        DokployId: instanceId
      };
      
      // Convert tags to AWS format
      const awsTags = Object.entries(tags).map(([key, value]) => ({
        Key: key,
        Value: String(value)
      }));

      // Get the latest Amazon Linux 2 AMI
      const amiResponse = await this.ec2.describeImages({
        Filters: [
          {
            Name: 'name',
            Values: ['amzn2-ami-hvm-2.0.*-x86_64-gp2']
          },
          {
            Name: 'state',
            Values: ['available']
          }
        ],
        Owners: ['amazon']
      }).promise();

      // Sort by creation date to get the latest
      const amis = amiResponse.Images || [];
      amis.sort((a, b) => {
        return (b.CreationDate || '') > (a.CreationDate || '') ? 1 : -1;
      });

      if (amis.length === 0) {
        throw new Error('No suitable AMI found');
      }

      const amiId = amis[0].ImageId;

      // Create security group for the instance
      const sgResponse = await this.ec2.createSecurityGroup({
        GroupName: `dokploy-${instanceId}`,
        Description: `Security group for Dokploy managed instance ${instanceName}`
      }).promise();

      const securityGroupId = sgResponse.GroupId;

      // Add necessary inbound rules
      await this.ec2.authorizeSecurityGroupIngress({
        GroupId: securityGroupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'SSH access' }]
          },
          {
            IpProtocol: 'tcp',
            FromPort: 6443,
            ToPort: 6443,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'Kubernetes API' }]
          },
          {
            IpProtocol: 'tcp',
            FromPort: 80,
            ToPort: 80,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTP' }]
          },
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTPS' }]
          }
        ]
      }).promise();

      // Create key pair for SSH access
      const keyName = `dokploy-${instanceId}`;
      const keyPairResponse = await this.ec2.createKeyPair({
        KeyName: keyName
      }).promise();

      // Save private key to a temporary file
      const privateKeyPath = path.join(os.tmpdir(), `${keyName}.pem`);
      fs.writeFileSync(privateKeyPath, keyPairResponse.KeyMaterial || '');
      fs.chmodSync(privateKeyPath, '0600');

      // Launch the instance
      const instanceResponse = await this.ec2.runInstances({
        ImageId: amiId,
        InstanceType: instanceType,
        MinCount: 1,
        MaxCount: 1,
        KeyName: keyName,
        SecurityGroupIds: [securityGroupId || ''],
        TagSpecifications: [
          {
            ResourceType: 'instance',
            Tags: awsTags
          }
        ],
        UserData: Buffer.from(`#!/bin/bash
          # Update system
          yum update -y
          yum install -y docker
          systemctl enable docker
          systemctl start docker
          
          # Add instance metadata to a file
          echo "DOKPLOY_INSTANCE_ID=${instanceId}" > /etc/dokploy-metadata
          echo "DOKPLOY_AUTO_DELETE=${request.autoDelete?.enabled || false}" >> /etc/dokploy-metadata
          echo "DOKPLOY_IDLE_THRESHOLD=${request.autoDelete?.idleThreshold || 60}" >> /etc/dokploy-metadata
          echo "DOKPLOY_MAX_LIFETIME=${request.autoDelete?.maxLifetime || 1440}" >> /etc/dokploy-metadata
        `).toString('base64')
      }).promise();

      const instance = instanceResponse.Instances?.[0];
      if (!instance) {
        throw new Error('Failed to create instance');
      }

      // Wait for the instance to be running
      await this.ec2.waitFor('instanceRunning', {
        InstanceIds: [instance.InstanceId || '']
      }).promise();

      // Get the instance details
      const describeResponse = await this.ec2.describeInstances({
        InstanceIds: [instance.InstanceId || '']
      }).promise();

      const runningInstance = describeResponse.Reservations?.[0]?.Instances?.[0];
      if (!runningInstance) {
        throw new Error('Failed to get instance details');
      }

      // Get instance type details for cost estimation
      const instanceTypes = await this.listAvailableInstanceTypes(this.region);
      const instanceTypeInfo = instanceTypes.find(type => type.name === instanceType);
      
      // Create the server resource object
      const serverResource: ServerResource = {
        id: instanceId,
        name: instanceName,
        cloudProviderId: this.config.id,
        provider: 'aws',
        region: this.region,
        instanceType: instanceType,
        publicIp: runningInstance.PublicIpAddress,
        privateIp: runningInstance.PrivateIpAddress,
        status: 'running',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        tags: tags,
        cost: {
          hourlyRate: instanceTypeInfo?.hourlyPrice || 0.05,
          currentBilling: 0
        }
      };

      return serverResource;
    } catch (error) {
      console.error('Error provisioning AWS server:', error);
      throw error;
    }
  }

  /**
   * Terminate an EC2 instance
   */
  async terminateServer(serverId: string): Promise<boolean> {
    try {
      // Find the instance by the Dokploy ID tag
      const instancesResponse = await this.ec2.describeInstances({
        Filters: [
          {
            Name: 'tag:DokployId',
            Values: [serverId]
          }
        ]
      }).promise();

      const instances = instancesResponse.Reservations?.flatMap(r => r.Instances || []) || [];
      if (instances.length === 0) {
        throw new Error(`No instance found with Dokploy ID: ${serverId}`);
      }

      const instanceId = instances[0].InstanceId;
      if (!instanceId) {
        throw new Error('Instance ID not found');
      }

      // Terminate the instance
      await this.ec2.terminateInstances({
        InstanceIds: [instanceId]
      }).promise();

      // Find and delete the key pair
      const keyName = `dokploy-${serverId}`;
      await this.ec2.deleteKeyPair({
        KeyName: keyName
      }).promise();

      // Find and delete the security group
      const sgResponse = await this.ec2.describeSecurityGroups({
        Filters: [
          {
            Name: 'group-name',
            Values: [`dokploy-${serverId}`]
          }
        ]
      }).promise();

      const securityGroups = sgResponse.SecurityGroups || [];
      if (securityGroups.length > 0) {
        const sgId = securityGroups[0].GroupId;
        if (sgId) {
          // Wait for the instance to terminate before deleting the security group
          await this.ec2.waitFor('instanceTerminated', {
            InstanceIds: [instanceId]
          }).promise();

          await this.ec2.deleteSecurityGroup({
            GroupId: sgId
          }).promise();
        }
      }

      return true;
    } catch (error) {
      console.error('Error terminating AWS server:', error);
      throw error;
    }
  }

  /**
   * Get the current status of an EC2 instance
   */
  async getServerStatus(serverId: string): Promise<ServerResource> {
    try {
      // Find the instance by the Dokploy ID tag
      const instancesResponse = await this.ec2.describeInstances({
        Filters: [
          {
            Name: 'tag:DokployId',
            Values: [serverId]
          }
        ]
      }).promise();

      const instances = instancesResponse.Reservations?.flatMap(r => r.Instances || []) || [];
      if (instances.length === 0) {
        throw new Error(`No instance found with Dokploy ID: ${serverId}`);
      }

      const instance = instances[0];
      
      // Map AWS instance state to our status enum
      let status: ServerResource['status'] = 'error';
      switch (instance.State?.Name) {
        case 'pending':
          status = 'provisioning';
          break;
        case 'running':
          status = 'running';
          break;
        case 'stopping':
        case 'stopped':
          status = 'stopped';
          break;
        case 'shutting-down':
        case 'terminated':
          status = 'terminated';
          break;
        default:
          status = 'error';
      }

      // Extract tags
      const tags: Record<string, string> = {};
      (instance.Tags || []).forEach(tag => {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      });

      // Get instance type details for cost estimation
      const instanceTypes = await this.listAvailableInstanceTypes(this.region);
      const instanceTypeInfo = instanceTypes.find(type => type.name === instance.InstanceType);

      // Get metrics
      const metrics = await this.getServerMetrics(serverId);

      // Create the server resource object
      const serverResource: ServerResource = {
        id: serverId,
        name: tags.Name || serverId,
        cloudProviderId: this.config.id,
        provider: 'aws',
        region: this.region,
        instanceType: instance.InstanceType || 't3.micro',
        publicIp: instance.PublicIpAddress,
        privateIp: instance.PrivateIpAddress,
        status,
        createdAt: instance.LaunchTime ? new Date(instance.LaunchTime) : new Date(),
        lastActiveAt: new Date(), // We don't have this info from AWS directly
        metrics,
        tags,
        cost: {
          hourlyRate: instanceTypeInfo?.hourlyPrice || 0.05,
          currentBilling: this.calculateCurrentBilling(instance.LaunchTime, instanceTypeInfo?.hourlyPrice || 0.05)
        }
      };

      return serverResource;
    } catch (error) {
      console.error('Error getting AWS server status:', error);
      throw error;
    }
  }

  /**
   * Calculate the current billing amount for an instance
   */
  private calculateCurrentBilling(launchTime: Date | undefined, hourlyRate: number): number {
    if (!launchTime) return 0;
    
    const now = new Date();
    const runningHours = (now.getTime() - launchTime.getTime()) / (1000 * 60 * 60);
    return parseFloat((runningHours * hourlyRate).toFixed(4));
  }

  /**
   * List all EC2 instances managed by Dokploy
   */
  async listServers(): Promise<ServerResource[]> {
    try {
      // Find instances with the Dokploy managed-by tag
      const instancesResponse = await this.ec2.describeInstances({
        Filters: [
          {
            Name: 'tag:ManagedBy',
            Values: ['dokploy']
          }
        ]
      }).promise();

      const instances = instancesResponse.Reservations?.flatMap(r => r.Instances || []) || [];
      
      // Get instance type details for cost estimation
      const instanceTypes = await this.listAvailableInstanceTypes(this.region);
      
      // Convert to ServerResource objects
      const servers: ServerResource[] = [];
      
      for (const instance of instances) {
        // Extract tags
        const tags: Record<string, string> = {};
        (instance.Tags || []).forEach(tag => {
          if (tag.Key && tag.Value) {
            tags[tag.Key] = tag.Value;
          }
        });
        
        // Skip if no DokployId tag
        if (!tags.DokployId) continue;
        
        // Map AWS instance state to our status enum
        let status: ServerResource['status'] = 'error';
        switch (instance.State?.Name) {
          case 'pending':
            status = 'provisioning';
            break;
          case 'running':
            status = 'running';
            break;
          case 'stopping':
          case 'stopped':
            status = 'stopped';
            break;
          case 'shutting-down':
          case 'terminated':
            status = 'terminated';
            break;
          default:
            status = 'error';
        }
        
        // Get instance type details
        const instanceTypeInfo = instanceTypes.find(type => type.name === instance.InstanceType);
        
        // Create the server resource object
        servers.push({
          id: tags.DokployId,
          name: tags.Name || tags.DokployId,
          cloudProviderId: this.config.id,
          provider: 'aws',
          region: this.region,
          instanceType: instance.InstanceType || 't3.micro',
          publicIp: instance.PublicIpAddress,
          privateIp: instance.PrivateIpAddress,
          status,
          createdAt: instance.LaunchTime ? new Date(instance.LaunchTime) : new Date(),
          lastActiveAt: new Date(), // We don't have this info from AWS directly
          tags,
          cost: {
            hourlyRate: instanceTypeInfo?.hourlyPrice || 0.05,
            currentBilling: this.calculateCurrentBilling(instance.LaunchTime, instanceTypeInfo?.hourlyPrice || 0.05)
          }
        });
      }
      
      return servers;
    } catch (error) {
      console.error('Error listing AWS servers:', error);
      throw error;
    }
  }

  /**
   * Install Kubernetes on an EC2 instance
   */
  async installKubernetes(serverId: string): Promise<{kubeconfig: string}> {
    try {
      // Get server details
      const server = await this.getServerStatus(serverId);
      if (server.status !== 'running') {
        throw new Error(`Server ${serverId} is not running`);
      }

      if (!server.publicIp) {
        throw new Error(`Server ${serverId} does not have a public IP`);
      }

      // Find the key pair
      const keyName = `dokploy-${serverId}`;
      const privateKeyPath = path.join(os.tmpdir(), `${keyName}.pem`);
      
      // If the key doesn't exist locally, we can't proceed
      if (!fs.existsSync(privateKeyPath)) {
        throw new Error(`SSH key not found for server ${serverId}`);
      }

      // Install k3s (lightweight Kubernetes) via SSH
      const sshCommand = `ssh -o StrictHostKeyChecking=no -i ${privateKeyPath} ec2-user@${server.publicIp}`;
      
      // Install k3s
      await execAsync(`${sshCommand} 'curl -sfL https://get.k3s.io | sh -'`);
      
      // Wait for k3s to be ready
      await execAsync(`${sshCommand} 'sleep 30'`);
      
      // Get kubeconfig
      const kubeconfigResult = await execAsync(`${sshCommand} 'sudo cat /etc/rancher/k3s/k3s.yaml'`);
      
      // Replace localhost with the server's public IP
      let kubeconfig = kubeconfigResult.stdout;
      kubeconfig = kubeconfig.replace(/server: https:\/\/127.0.0.1:6443/g, `server: https://${server.publicIp}:6443`);
      
      return { kubeconfig };
    } catch (error) {
      console.error('Error installing Kubernetes on AWS server:', error);
      throw error;
    }
  }

  /**
   * Get resource metrics for an EC2 instance
   */
  async getServerMetrics(serverId: string): Promise<ServerResource['metrics']> {
    try {
      // Find the instance by the Dokploy ID tag
      const instancesResponse = await this.ec2.describeInstances({
        Filters: [
          {
            Name: 'tag:DokployId',
            Values: [serverId]
          }
        ]
      }).promise();

      const instances = instancesResponse.Reservations?.flatMap(r => r.Instances || []) || [];
      if (instances.length === 0) {
        throw new Error(`No instance found with Dokploy ID: ${serverId}`);
      }

      const instance = instances[0];
      const instanceId = instance.InstanceId;
      if (!instanceId) {
        throw new Error('Instance ID not found');
      }

      // Get metrics from CloudWatch
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 15 * 60 * 1000); // Last 15 minutes

      const metricData = await this.cloudwatch.getMetricData({
        StartTime: startTime,
        EndTime: endTime,
        MetricDataQueries: [
          {
            Id: 'cpu',
            MetricStat: {
              Metric: {
                Namespace: 'AWS/EC2',
                MetricName: 'CPUUtilization',
                Dimensions: [
                  {
                    Name: 'InstanceId',
                    Value: instanceId
                  }
                ]
              },
              Period: 300, // 5 minutes
              Stat: 'Average'
            }
          },
          {
            Id: 'networkIn',
            MetricStat: {
              Metric: {
                Namespace: 'AWS/EC2',
                MetricName: 'NetworkIn',
                Dimensions: [
                  {
                    Name: 'InstanceId',
                    Value: instanceId
                  }
                ]
              },
              Period: 300,
              Stat: 'Average'
            }
          },
          {
            Id: 'networkOut',
            MetricStat: {
              Metric: {
                Namespace: 'AWS/EC2',
                MetricName: 'NetworkOut',
                Dimensions: [
                  {
                    Name: 'InstanceId',
                    Value: instanceId
                  }
                ]
              },
              Period: 300,
              Stat: 'Average'
            }
          }
        ]
      }).promise();

      // Extract the latest values
      const cpuValues = metricData.MetricDataResults?.find(r => r.Id === 'cpu')?.Values || [];
      const networkInValues = metricData.MetricDataResults?.find(r => r.Id === 'networkIn')?.Values || [];
      const networkOutValues = metricData.MetricDataResults?.find(r => r.Id === 'networkOut')?.Values || [];

      // Use the latest value or default to 0
      const cpuUtilization = cpuValues.length > 0 ? cpuValues[0] : 0;
      const networkIn = networkInValues.length > 0 ? networkInValues[0] : 0;
      const networkOut = networkOutValues.length > 0 ? networkOutValues[0] : 0;

      // Memory utilization is not directly available from CloudWatch for EC2
      // We'll estimate it based on CPU utilization for now
      const memoryUtilization = Math.min(cpuUtilization * 0.8, 100); // Simple estimation

      return {
        cpuUtilization,
        memoryUtilization,
        networkIn,
        networkOut
      };
    } catch (error) {
      console.error('Error getting AWS server metrics:', error);
      // Return default metrics instead of throwing
      return {
        cpuUtilization: 0,
        memoryUtilization: 0,
        networkIn: 0,
        networkOut: 0
      };
    }
  }
} 