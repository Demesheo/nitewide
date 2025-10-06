import sequelize from '../config/database.js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import {
  User,
  Organization,
  Event,
  Guestlist,
  Ticket,
  OrgAffiliate,
  EventAffiliate,
} from '../models/index.js';

async function seed() {
  try {
    // Clean DB
    await sequelize.sync({ force: true });

    // --------------------
    // Create Admin User
    // --------------------
    const adminPasswordHash = await bcrypt.hash('AdminPassword123!', 10);
    const admin = await User.create({
      id: uuidv4(),
      name: 'Admin User',
      email: 'admin@nitewide.com',
      phoneNumber: '555-555-5555',
      passwordHash: adminPasswordHash,
      isAdmin: true,
    });

    // --------------------
    // Create 12 Orlando Nightclubs
    // --------------------
    const orgsData = [
      {
        name: 'Euphoria Downtown',
        streetAddress: '110 S Orange Ave',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5405,
        longitude: -81.3792,
        description: 'Vibrant venue with live performances and themed parties.',
      },
      {
        name: 'Room 22',
        streetAddress: '114 S Orange Ave',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5408,
        longitude: -81.3795,
        description: "Downtown Orlando's premier show bar.",
      },
      {
        name: 'Parlay',
        streetAddress: '39 N Orange Ave',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5421,
        longitude: -81.3798,
        description: 'Trendy spot known for its lively atmosphere.',
      },
      {
        name: 'Proper',
        streetAddress: '101 E Central Blvd',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5400,
        longitude: -81.3790,
        description: 'Upscale venue offering a refined nightlife experience.',
      },
      {
        name: 'Celine',
        streetAddress: '22 S Magnolia Ave',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5402,
        longitude: -81.3793,
        description: 'Chic venue offering live music and DJ sets.',
      },
      {
        name: 'Tier',
        streetAddress: '20 E Central Blvd',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5403,
        longitude: -81.3794,
        description: 'High-energy nightclub with vibrant atmosphere.',
      },
      {
        name: 'Eden',
        streetAddress: '23 E Central Blvd',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5404,
        longitude: -81.3796,
        description: 'Modern lounge with diverse entertainment options.',
      },
      {
        name: 'Aura',
        streetAddress: '49 N Orange Ave',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5406,
        longitude: -81.3797,
        description: 'Premier nightclub offering a dynamic experience.',
      },
      {
        name: 'La Rosa',
        streetAddress: '123 W Church St',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5407,
        longitude: -81.3800,
        description: 'Cozy venue with intimate live music.',
      },
      {
        name: 'Shakai',
        streetAddress: '456 W Church St',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5409,
        longitude: -81.3801,
        description: 'Vibrant spot with entertainment and dining.',
      },
      {
        name: 'Fixtion',
        streetAddress: '789 W Church St',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5410,
        longitude: -81.3802,
        description: 'Energetic venue with themed events.',
      },
      {
        name: 'The Beacham',
        streetAddress: '46 N Orange Ave',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        metroArea: 'Orlando-Kissimmee',
        latitude: 28.5401,
        longitude: -81.3799,
        description: 'Iconic venue with live performances and events.',
      },
    ];

    const orgs = [];
    for (const orgData of orgsData) {
      const org = await Organization.create({
        ...orgData,
        id: uuidv4(),
        ownerId: admin.id,
      });
      orgs.push(org);

      // --------------------
      // Create 1 Event per Org
      // --------------------
      const now = Math.floor(Date.now() / 1000);
      const event = await Event.create({
        id: uuidv4(),
        name: `${org.name} Grand Opening`,
        startTime: now,
        endTime: now + 4 * 3600, // 4 hours later
        organizationId: org.id,
        ownerId: admin.id,
        description: `Grand opening for ${org.name}`,
      });

      // --------------------
      // Create Guestlist entry
      // --------------------
      await Guestlist.create({
        id: uuidv4(),
        email: 'guest@example.com',
        eventId: event.id,
        userId: admin.id,
      });

      // --------------------
      // Create Ticket
      // --------------------
      await Ticket.create({
        id: uuidv4(),
        status: 'active',
        price: 50.0,
        eventId: event.id,
        buyerId: admin.id,
      });

      // --------------------
      // Create EventAffiliate
      // --------------------
      await EventAffiliate.create({
        id: uuidv4(),
        eventId: event.id,
        userId: admin.id,
      });

      // --------------------
      // Create OrgAffiliate
      // --------------------
      await OrgAffiliate.create({
        id: uuidv4(),
        organizationId: org.id,
        userId: admin.id,
      });
    }

    console.log('✅ Seed complete!');
    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seed();
