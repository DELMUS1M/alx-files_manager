import { ObjectID } from 'mongodb';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import Queue from 'bull';
import dbClient from '../utils/db';
// import redisClient from '../utils/redis';
import { findUserIdByToken, findUserById } from '../utils/auth';

class FilesController {
  static async postUpload(request, response) {
    const fileQueue = new Queue('fileQueue');

    const userId = await findUserIdByToken(request);
    if (!userId) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    let fileInserted;

    const { name } = request.body;
    if (!name) {
      return response.status(400).json({ error: 'Missing name' });
    }

    const { type } = request.body;
    if (!type || !['folder', 'file', 'image'].includes(type)) {
      return response.status(400).json({ error: 'Missing type' });
    }

    const isPublic = request.body.isPublic || false;
    const parentId = request.body.parentId || 0;
    const { data } = request.body;
    if (!data && !['folder'].includes(type)) {
      return response.status(400).json({ error: 'Missing data' });
    }

    if (parentId !== 0) {
      const parentFileArray = await dbClient.files.find({ _id: ObjectID(parentId) }).toArray();
      if (parentFileArray.length === 0) {
        return response.status(400).json({ error: 'Parent not found' });
      }
      const file = parentFileArray[0];
      if (file.type !== 'folder') {
        return response.status(400).json({ error: 'Parent is not a folder' });
      }
    }

    if (!data && type !== 'folder') {
      return response.status(400).json({ error: 'Missing Data' });
    }

    if (type === 'folder') {
      fileInserted = await dbClient.files.insertOne({
        userId: ObjectID(userId),
        name,
        type,
        isPublic,
        parentId: parentId === 0 ? parentId : ObjectID(parentId),
      });
    } else {
      const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true }, () => { });

      const filenameUUID = uuidv4();
      const localPath = `${folderPath}/${filenameUUID}`;

      const clearData = Buffer.from(data, 'base64');
      await fs.promises.writeFile(localPath, clearData.toString(), { flag: 'w+' });
      await fs.readdirSync('/').forEach((file) => {
        console.log(file);
      });

      fileInserted = await dbClient.files.insertOne({
        userId: ObjectID(userId),
        name,
        type,
        isPublic,
        parentId: parentId === 0 ? parentId : ObjectID(parentId),
        localPath,
      });

      if (type === 'image') {
        await fs.promises.writeFile(localPath, clearData, { flag: 'w+', encoding: 'binary' });
        await fileQueue.add({ userId, fileId: fileInserted.insertedId, localPath });
      }
    }

    return response.status(201).json({
      id: fileInserted.ops[0]._id, userId, name, type, isPublic, parentId,
    });
  }

  static async getShow(request, response) {
    const userID = findUserIdByToken(request);
    if (!userID) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const user = findUserById(userID);
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const idFile = request.params.id || '';

    const fileDocument = await dbClient.db.collection('files').findOne({ _id: ObjectID(idFile), userId: user._id });
    if (!fileDocument) {
      return response.status(404).send({ error: 'Not found' });
    }

    return response.send({
      id: fileDocument._id,
      userId: fileDocument.userId,
      name: fileDocument.name,
      type: fileDocument.type,
      isPublic: fileDocument.isPublic,
      parentId: fileDocument.parentId,
    });
  }

  static async getIndex(request, response) {
    const userID = findUserIdByToken(request);
    if (!userID) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const parentId = request.query.parentId || '0';
    const pagination = request.query.page || 0;

    const user = findUserById(userID);
    if (!user) {
      response.status(401).json({ error: 'Unauthorized' });
    }

    const aggregationMatch = { $and: [{ parentId }] };
    let aggregateData = [
      { $match: aggregationMatch },
      { $skip: pagination * 20 },
      { $limit: 20 },
    ];
    if (parentId === 0) {
      aggregateData = [{ $skip: pagination * 20 }, { $limit: 20 }];
    }

    const files = await dbClient.db.collection('files').aggregate(aggregateData);
    const filesArray = [];
    await files.forEach((item) => {
      const fileItem = {
        id: item._id,
        userId: item.userId,
        name: item.name,
        type: item.type,
        isPublic: item.isPublic,
        parentId: item.parentId,
      };
      filesArray.push(fileItem);
    });

    return response.send(filesArray);
  }

  static async putPublish(request, response) {
    const userID = findUserIdByToken(request);
    if (!userID) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const user = findUserById(userID);
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const idFile = request.params.id || '';

    let fileDocument = await dbClient.db.collection('files').findOne({ _id: ObjectID(idFile), userId: user._id });
    if (!fileDocument) {
      return response.status(404).send({ error: 'Not found' });
    }

    await dbClient.db.collection('files').update({ _id: ObjectID(idFile) }, { $set: { isPublic: true } });
    fileDocument = await dbClient.db.collection('files').findOne({ _id: ObjectID(idFile), userId: user._id });

    return response.send({
      id: fileDocument._id,
      userId: fileDocument.userId,
      name: fileDocument.name,
      type: fileDocument.type,
      isPublic: fileDocument.isPublic,
      parentId: fileDocument.parentId,
    });
  }

  static async putUnpublish(request, response) {
    const userID = findUserIdByToken(request);
    if (!userID) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const user = findUserById(userID);
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const idFile = request.params.id || '';

    let fileDocument = await dbClient.db.collection('files').findOne({ _id: ObjectID(idFile), userId: user._id });
    if (!fileDocument) return response.status(404).send({ error: 'Not found' });

    await dbClient.db.collection('files').update({ _id: ObjectID(idFile), userId: user._id }, { $set: { isPublic: false } });
    fileDocument = await dbClient.db.collection('files').findOne({ _id: ObjectID(idFile), userId: user._id });

    return response.send({
      id: fileDocument._id,
      userId: fileDocument.userId,
      name: fileDocument.name,
      type: fileDocument.type,
      isPublic: fileDocument.isPublic,
      parentId: fileDocument.parentId,
    });
  }
}

module.exports = FilesController;
