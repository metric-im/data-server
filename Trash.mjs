/**
 * Halfway house for lost objects
 */
import express from 'express';

export default class Trash {
    constructor(connector) {
        this.connector = connector;
        this.trashCollection = this.connector.db.collection('trash');
    }

    /**
     * Include after access control so Users can't directly access trash function
     * unless given access to the trash collection
     */
    routes() {
        let router = express.Router();
        router.get('/data/trash/',async (req,res,next)=> {
            try {
                let selector = {};
                if (req.params.item) {
                    if (!req.account.super && !req._availableAccounts.includes(req.params.item)) return res.status(401).send();
                    selector._id = req.params.item;
                } else if (!req.account.super) {
                    selector._id = {$in:req._availableAccounts};
                }
                if (req.query.where) Object.assign(selector,this.parser.objectify(req.query.where));
                let sort = (req.query.sort)?this.parser.sortify(req.query.sort):{_id:1};
                let results = await this.connector.db.collection(collection).find(selector).collation({ locale:"en_US", strength:2}).sort(sort).toArray();
                return (req.params.item?results[0]||{}:results);
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        })
        router.put('/data/trash/:item?',async(req,res)=>{
            try {
                res.status(400).json('{status:400,message:"illegal request}');
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        });
        router.delete('/data/trash/:ids',async(req,res)=>{
            try {
                await this.empty('','',req.params.ids.split(','))
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
        if (!Array.isArray(ids)) ids = [ids];
        if (ids.length === 0) throw new Error("Empty data set");
        let body = typeof ids[0] === 'object' ? ids
            :await this.connector.db.collection(col).find({_id:{$in:body}}).toArray() ;
        let writes = [];
        let deleteIds = [];
        for (let o of body) {
            deleteIds.push(o._id);
            writes.push({updateOne:{filter:{col:col,oid:body._id},update:{
                $setOnInsert:{_id:col+'#'+o._id,_created:now,_createdBy:account.userId},
                _modified:now,
                o:o
            },upsert:true}});
        }
        await this.trashCollection(col).bulkWrite(writes);
        await this.connector.db.collection(col).deleteMany({_id:{$in:deleteIds}});
    }

    /**
     * Restore the identified item(s) from trash to the original collection
     * @param col
     * @param ids
     * @returns {Promise<void>}
     */
    async restore(ids) {
        if (!Array.isArray(body)) ids = [ids];
        if (ids.length === 0) throw new Error("Empty data set");
        let body = await this.trashCollection.find({_id:{$in:ids}}).toArray();
        let writes = {};
        for (let item of body) {
            if (!writes[item.oid]) writes[item.oid] = [];
            writes[item.oid].push({insertOne:item.o});
        }
        for (let col in writes) {
            await this.connector.db.collection(col).bulkWrite(writes);
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
        let item = await this.trashCollection(col).findOne({_id:id});
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
        if (oid) query.oid = oid;
        if (_id) query._id = _id;
        await this.trashCollection.deleteMany(query);
    }
}
