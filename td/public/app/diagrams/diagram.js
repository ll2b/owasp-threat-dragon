﻿(function () {
    'use strict';

    // Controller name is handy for logging
    var controllerId = 'diagram';

    // Define the controller on the module.
    // Inject the dependencies. 
    // Point to the controller definition function.
    angular.module('app').controller(controllerId,
        ['$scope', '$location', '$routeParams', '$timeout', 'dialogs', 'common', 'datacontext', 'threatengine', 'diagramming', diagram]);

    function diagram($scope, $location, $routeParams, $timeout, dialogs, common, datacontext, threatengine, diagramming) {

        // Using 'Controller As' syntax, so we assign this to the vm variable (for viewmodel).
        /*jshint validthis: true */
        var vm = this;
        var getLogFn = common.logger.getLogFn;
        var log = getLogFn(controllerId);
        var logError = getLogFn(controllerId, 'error');
        var scope = $scope;
        var elementPropertiesCache = {};
        var deletedElements = {};
        var currentDiagram = {};

        // Bindable properties and functions are placed on vm.
        vm.title = 'ThreatModelDiagram';
        vm.initialise = initialise,
        /*jshint -W030 */
        vm.dirty = false;
        vm.graph = diagramming.newGraph();
        vm.newProcess = newProcess;
        vm.newStore = newStore;
        vm.newFlow = newFlow;
        vm.newActor = newActor;
        vm.newBoundary = newBoundary;
        vm.select = select;
        vm.edit = edit;
        vm.generateThreats = generateThreats;
        vm.selected = {};
        vm.viewStencil = true;
        vm.viewThreats = false;
        vm.stencils = getStencils();
        vm.zoomIn = zoomIn;
        vm.zoomOut = zoomOut;
        vm.reload = reload;
        vm.save = save;
        vm.clear = clear;
        vm.threatModelId = $routeParams.threatModelId;
        vm.diagramId = $routeParams.diagramId;
        vm.currentZoomLevel = 0;
        vm.maxZoom = 4;

        //structured exit
        $scope.$on('$locationChangeStart', function (event, current, previous)
        {
            //suppress structured exit when only search changes
            var absPathCurrent = current.split('?')[0];
            var absPathPrevious = previous.split('?')[0];

            if (vm.dirty && absPathCurrent != absPathPrevious) {
                dialogs.structuredExit(event, function () { }, function () { vm.dirty = false; });
            }
        });

        //element select
        $scope.$on('$locationChangeSuccess', function (event, current, previous)
        {
            onSelectElement();
        });

        activate();

        function activate() {
            common.activateController([], controllerId)
                .then(function () { log('Activated Threat Model Diagram View'); });
        }

        function getStencils() {

            var shapes = [
                { shape: { className: 'joint.shapes.tm.Process', label: 'Process' }, action: newProcess },
                { shape: { className: 'joint.shapes.tm.Store', label: 'Store'}, action: newStore },
                { shape: { className: 'joint.shapes.tm.Actor', label: 'Actor'}, action: newActor },
                { shape: { className: 'joint.shapes.tm.Flow', label: 'Data Flow'}, action: newFlow },
                { shape: { className: 'joint.shapes.tm.Boundary', label: 'Trust\nBoundary' }, action: newBoundary }];

            return shapes;
        }

        function save()
        {
            var diagramJson = JSON.stringify(vm.graph);
            var diagramData = { diagramJson: diagramJson };
            
            if (angular.isDefined(currentDiagram.options) && angular.isDefined(currentDiagram.options.height) && angular.isDefined(currentDiagram.options.width)) {
                var size = { height: currentDiagram.options.height, width: currentDiagram.options.width };
                diagramData.size = size;     
            }
            
            datacontext.saveThreatModelDiagram(vm.threatModelId, vm.diagramId, diagramData)
                .then(flushElementPropertiesCache)
                .then(flushDeletedElements)
                .then(onSaveDiagram);
        }

        function onSaveDiagram()
        {
            vm.dirty = false;
            addDirtyEventHandlers();
        }

        function initialise(newDiagram)
        {
            currentDiagram = newDiagram;
            datacontext.getThreatModelDiagram(vm.threatModelId, vm.diagramId).then(onGetThreatModelDiagram, onError);

            function onGetThreatModelDiagram(data) {
                
                if (angular.isDefined(data.diagramJson)) {
                    diagramming.initialise(vm.graph, data.diagramJson);
                }
                
                if (angular.isDefined(data.size)) {
                    diagramming.resize(currentDiagram, data.size);
                }
                    
                vm.graph.on('remove', removeElement);
                addDirtyEventHandlers();
                vm.loaded = true;
                vm.diagram = data;
                elementPropertiesCache = {};
                deletedElements = {};
                vm.dirty = false;
                
                if ($routeParams.element) {
                    var element = diagramming.getCellById(vm.graph, $routeParams.element);
                    initialSelect(element);
                    //a bit ugly - can we remove the dependency on the diagram?
                    currentDiagram.setSelected(element);

                    //more ugliness, but $evalAsync does not work!?
                    //This is to ensure the stencils are rendered before they are collapsed
                    //It is a bit jank though as you see the stencil accordian element collapse :(
                    $timeout(function () {
                        vm.viewStencil = false;
                        vm.viewThreats = true;
                    });
                }
            }
        }

        function reload()
        {
            //only ask for confirmation if diagram is dirty AND it has some cells
            //avoids the confirmation if you are reloading after an accidental clear of the model
            if (vm.dirty && diagramming.cellCount(vm.graph) > 0)
            {
                dialogs.confirm('./app/diagrams/confirmReloadOnDirty.html', function() { vm.initialise(currentDiagram); });
            }
            else
            {
                vm.initialise(currentDiagram);
            }  
        }

        function clear()
        {
            diagramming.getElements(vm.graph).forEach(function (element) { addToDeletedElements(element); });
            diagramming.getLinks(vm.graph).forEach(function (element) { addToDeletedElements(element); });
            diagramming.clear(vm.graph);
        }

        function zoomIn()
        {
            if (vm.currentZoomLevel < vm.maxZoom)
            {
                vm.currentZoomLevel++;
                diagramming.zoom(currentDiagram, vm.currentZoomLevel);
            }
        }

        function zoomOut()
        {
            if (vm.currentZoomLevel > -vm.maxZoom) {
                vm.currentZoomLevel--;
                diagramming.zoom(currentDiagram, vm.currentZoomLevel);
            }
        }

        function onError(error)
        {
            vm.loaded = false;
            logError(error);
        }

        function edit()
        {
            vm.dirty = true;
        }
        
        function generateThreats()
        {
            if (vm.selected.element)
            {
                threatengine.generateForElement(vm.selected).then(onGenerateThreats);
            }
        }

        function onGenerateThreats(threats)
        {
            var threatList = threats;
            var currentThreat;
            suggestThreat();        
        
            function suggestThreat()
            {
                if (threatList.length > 0) {
                    currentThreat = threatList.shift();
                    dialogs.confirm('./app/diagrams/ThreatEditPane.html', addThreat, function () { return { heading: 'Add this threat?', threat: currentThreat, editing: false }; }, ignoreThreat, 'fade-right');
                }
            }

            function addThreat(applyToAll)
            {
                vm.dirty = true;
                vm.selected.elementProperties.threats.push(currentThreat);
                
                if(applyToAll)
                {
                    threatList.forEach(function(threat) {
                        
                        vm.selected.elementProperties.threats.push(threat);
                    });
                }
                else
                {
                    $timeout(suggestThreat, 500);    
                }
            }

            function ignoreThreat(applyToAll)
            {
                if(!applyToAll)
                {
                    $timeout(suggestThreat, 500);
                }
            }
        }
        
        function onSelectElement()
        {
            if (vm.selected.elementProperties)
            {
                elementPropertiesCache[vm.selected.element.id] = vm.selected.elementProperties;
            }

            var element = null;
            var elementId = $routeParams.element;

            if (elementId)
            {
                element = diagramming.getCellById(vm.graph, elementId);
            }

            vm.selected.element = element;         

            if (element)
            {
                if (elementPropertiesCache[element.id])
                {
                    vm.selected.elementProperties = elementPropertiesCache[element.id];
                }
                else
                {
                    datacontext.getElementProperties(vm.threatModelId, vm.diagramId, element.id).then(onGetElementProperties);
                }
            }
            else
            {
                vm.selected.elementProperties = null;
            }
            
            //existence test is required to support unit tests where currentDiagram is not initialised
            if (typeof currentDiagram.setSelected === 'function' || typeof currentDiagram.setSelected === 'object') {
                currentDiagram.setSelected(element);
            }
        }

        function initialSelect(element)
        {
            vm.selected.element = element;
            datacontext.getElementProperties(vm.threatModelId, vm.diagramId, element.id).then(onGetElementProperties);
        }

        function select(element)
        {
            var elementId = null;

            if (element)
            {
                elementId = element.id;
            }

            $location.search('element', elementId);
            scope.$apply();
        }

        function onGetElementProperties(data)
        {
            vm.selected.elementProperties = data;
            //this could be made more efficient - only add to the cache when dirty?
            elementPropertiesCache[vm.selected.elementProperties.elementId] = vm.selected.elementProperties;
        }

        function removeElement(element, graph, clearing)
        {
            vm.dirty = true;
            addToDeletedElements(element);
            vm.selected = {};
            $location.search('element', null);
            //scope.$apply cause an exception when clearing all elements (digest already in progress)
            if (!clearing) { scope.$apply(); }
        }

        function newProcess()
        {
            var process = diagramming.newProcess(vm.graph);
            elementPropertiesCache[process.id] = { threatModelId: vm.threatModelId, diagramId: vm.diagramId, elementId: process.id, threats: [] };
        }

        function newStore()
        {
            var store = diagramming.newStore(vm.graph);
            elementPropertiesCache[store.id] = { threatModelId: vm.threatModelId, diagramId: vm.diagramId, elementId: store.id, threats: [] };
        }

        function newActor()
        {
            var actor = diagramming.newActor(vm.graph);
            elementPropertiesCache[actor.id] = { threatModelId: vm.threatModelId, diagramId: vm.diagramId, elementId: actor.id, threats: [] };
        }

        function newFlow(source, target) {

            var flow = diagramming.newFlow(vm.graph, source, target);
            elementPropertiesCache[flow.id] = { threatModelId: vm.threatModelId, diagramId: vm.diagramId, elementId: flow.id, threats: [] };
        }

        function newBoundary() {
            var boundary = diagramming.newBoundary(vm.graph);
            elementPropertiesCache[boundary.id] = { threatModelId: vm.threatModelId, diagramId: vm.diagramId, elementId: boundary.id, threats: []};
        }

        function addDirtyEventHandlers() {

            vm.graph.on('change add', setDirty);

            function setDirty()
            {
                vm.dirty = true;
                vm.graph.off('change add', setDirty);
                scope.$apply();
            }
        }

        function flushElementPropertiesCache()
        {
            for (var key in elementPropertiesCache)
            {
                if (elementPropertiesCache.hasOwnProperty(key))
                {
                    datacontext.saveElementProperties(elementPropertiesCache[key]);
                }
            }
        }

        function flushDeletedElements()
        {
            for (var key in deletedElements)
            {
                if (deletedElements.hasOwnProperty(key))
                {
                    datacontext.deleteElementProperties(vm.threatModelId, vm.diagramId, key).then(null);
                }
            }

            deletedElements = {};
        }

        function addToDeletedElements(element)
        {
            delete elementPropertiesCache[element.id];
            deletedElements[element.id] = element;
        }
    }
})();