/**
 * Halfway house for lost objects
 */
import express from 'express';
import Parser from "./Parser.mjs";

export default class Trash {
    constructor(connector) {
        this.connector = connector;
        this.parser = Parser
        this.trashCollection = this.connector.db.collection('trash');
    }

    /**
     * Include after access control so Users can't directly access trash function
     * unless given access to the trash collection
     */
    routes() {
        let router = express.Router();
        router.get('/data/trash/:item?',async (req,res,next)=> {
            try {
                let selector = {};
                if (!req._availableAccounts) req._availableAccounts = []
                if (req.params.item) {
                    // if (!req.account.super && !req._availableAccounts.includes(req.params.item)) return res.status(401).send();
                    selector._id = req.params.item;
                } else if (!req.account.super && req._availableAccounts.length !== 0) {
                    selector._id = {$in:req._availableAccounts};
                }
                if (req.query.where) Object.assign(selector,this.parser.objectify(req.query.where));
                let sort = (req.query.sort)?this.parser.sortify(req.query.sort):{_id:1};
                let results = await this.trashCollection.find(selector).collation({ locale:"en_US", strength:2}).sort(sort).toArray();
                const response = req.params.item?results[0]||{}:results;
                res.status(200).json(response)
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        })
        /**
         * Put item(s) into trash with PUT. This is not supported. Use DELETE /data/{id}
         */
        router.put('/data/trash/:item?',async(req,res)=>{
            try {
                res.status(400).json('{status:400,message:"illegal request}');
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        });
        /**
         * Restore item(s) from trash with POST
         */
        router.post('/data/trash/:item?',async(req,res)=>{
            try {
                await this.restore(req.params.item)
                res.status(204).json();
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        });
        router.delete('/data/trash/:col?/:ids?',async(req,res)=>{
            try {
                if (!req.params.col) {
                    if (!req.account.super) return res.status(401).send('empty all trash forbidden');
                }
                await this.empty(req.params.col,req.params.ids)
                res.status(204).send();
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        });
        return router;
    }

    /**
     * Get trash items. Limit return set with the parameters *col* and *id*
     * @param account not used
     * @param col collection
     * @param oid _id of the item in the collection
     * @param _id _id of the trash item
     * @returns {Promise<*>}
     */
    async get(account,col,id,_id) {
        let query = {};
        if (col) query.col = col;
        if (oid) query.oid = oid;
        if (_id) query._id = _id;
        return this.trashCollection.find(query).toArray()
    }

    /**
     * Put the identified object(s) into the trash collection and remove the original
     * @param body
     * @returns {Promise<void>}
     */
    async put(account,col,ids) {
        let now = new Date();
        if (typeof ids === 'string') ids = ids.split(',');
        if (ids.length === 0) throw new Error("Empty data set");
        let body = typeof ids[0] === 'object' ? ids
            :await this.connector.db.collection(col).find({_id:{$in:ids}}).toArray() ;
        let writes = [];
        let deleteIds = [];
        for (let o of body) {
            deleteIds.push(o._id);
            writes.push({updateOne:{filter:{col:col,oid:o._id},update:{
                        $setOnInsert:{_id:col+'::'+o._id,_created:now,_createdBy:account.userId},
                        $set:{_modified:now, o:o}
                    },upsert:true}});
        }
        if (writes.length > 0) await this.trashCollection.bulkWrite(writes);
        if (deleteIds.length > 0) await this.connector.db.collection(col).deleteMany({_id:{$in:deleteIds}});
    }

    /**
     * Restore the identified item(s) from trash to the original collection
     * @param col
     * @param ids
     * @returns {Promise<void>}
     */
    async restore(ids) {
        if (!ids) throw new Error("Empty data set");
        if (!Array.isArray(ids)) ids = [ids];
        if (ids.length === 0) throw new Error("Empty data set");
        let body = await this.trashCollection.find({_id:{$in:ids}}).toArray();
        let writes = {};
        for (let item of body) {
            if (!writes[item.col]) writes[item.col] = [];
            writes[item.col].push({insertOne:item.o});
        }
        for (let col in writes) {
            await this.connector.db.collection(col).bulkWrite(writes[col]);
        }
        await this.trashCollection.deleteMany({_id:{$in:ids}});
    }

    /**
     * Copy an item from trash back to the original collection with a new id
     * @param col
     * @param id
     * @returns {Promise<void>}
     */
    async pluck(col, id, newId) {
        let item = await this.trashCollection.findOne({_id:id});
        if (!item) throw new Error("Not found");
        await this.connector.db.collection(col).insertOne(item);
    }

    /**
     * Delete items in the trash collection. Ostensibly destroying them.
     * If no arguments are provided, all items in trash are deleted
     * @param col delete only items in this collection
     * @param oid delete only the item with this oid
     * @param _id delete only the item with this trash _id
     * @returns {Promise<*>}
     */
    async empty(col,oid,_id) {
        let query = {};
        if (col) query.col = col;
        if (oid) {
            if (!Array.isArray(oid)) oid = oid.split(',');
            query.oid = {$in:oid};
        }
        if (_id) {
            if (!Array.isArray(_id)) _id = _id.split(',');
            query._id = {$in:_id};
        }
        await this.trashCollection.deleteMany(query);
    }
}